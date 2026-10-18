import { createSessionStore } from './session-store.js';
import { getProvider } from '../shared/providers.js';
import { normalizeAnswer } from '../shared/answer-parser.js';
import { requestKey } from '../shared/session-guard.js';
import { editorAccess } from './editor-access.js';
import { fetchImageDataUrl } from './image-fetch.js';

const terminal = s => !s || ['done', 'aborted', 'error'].includes(s.phase);
const identity = s => ({ sessionId: s.id, requestId: s.requestId, questionKey: s.questionKey });
const sameRequest = (s, m) => s && s.id === m.sessionId && s.requestId === m.requestId && s.questionKey === m.questionKey;

// All durable session mutations pass through this owner. Provider operations run
// outside the mutation queue; identity checks discard their late completions.
export function createBackground(api) {
  const store = createSessionStore({
    read: async () => (await api.storage.local.get('sabetSession')).sabetSession || null,
    write: s => api.storage.local.set({ sabetSession: s }),
  });
  const activeRequest = async s => {
    const now = await store.read();
    return now?.phase === 'waiting_for_answer' && sameRequest(now, identity(s));
  };
  const notify = async s => {
    if (s?.tabId) await api.tabs.sendMessage(s.tabId, { action: 'SESSION_CHANGED', sessionId: s.id }).catch(() => {});
  };
  const popupSender = sender => sender.url === 'chrome-extension://' + api.runtime.id + '/popup.html';
  const owner = (s, sender) => s && (popupSender(sender) || !sender.tab || sender.tab.id === s.tabId);
  const providerSender = (s, sender) => {
    if (!s || sender.tab?.id !== s.providerTabId) return false;
    try { return new URL(sender.url || sender.tab.url).hostname === getProvider(s.provider).hostMatch; } catch { return false; }
  };
  const cleanup = async (s, close = false) => {
    if (!s) return;
    await api.alarms.clear('sabet-request:' + requestKey(identity(s)));
    if (s.providerTabId) {
      await api.tabs.sendMessage(s.providerTabId, { action: 'STOP_PROCESS', ...identity(s) }).catch(() => {});
      if (close) await api.tabs.remove(s.providerTabId).catch(() => {});
    }
  };
  const fail = async (s, error) => {
    const next = await store.failure(identity(s), String(error).slice(0, 800));
    if (!next) return;
    await cleanup(s, true);
    await notify(next);
  };
  const accept = async (s, raw) => {
    const answer = normalizeAnswer(raw);
    if (!answer) { await fail(s, 'Jawaban AI tidak valid.'); return; }
    const next = await store.answer(identity(s), answer);
    if (!next) return;
    await api.alarms.clear('sabet-request:' + requestKey(identity(s)));
    await notify(next);
  };
  const openTab = async s => {
    const provider = getProvider(s.provider);
    // One conversation per request prevents a previous turn from becoming the
    // answer to a new question and avoids unbounded chat history growth.
    const previous = (await api.storage.local.get('sabetProviderTab')).sabetProviderTab;
    if (previous) {
      const tab = await api.tabs.get(previous).catch(() => null);
      if (!(await activeRequest(s))) return;
      if (tab) await api.tabs.remove(previous).catch(() => {});
    }
    if (!(await activeRequest(s))) return;
    const tab = await api.tabs.create({ url: provider.url, active: true });
    const bound = await store.bindTab(identity(s), tab.id);
    if (!bound) { await api.tabs.remove(tab.id).catch(() => {}); return; }
    await api.storage.local.set({ sabetProviderTab: tab.id });
    await api.tabs.sendMessage(tab.id, { action: 'NEW_PAYLOAD', ...identity(s) }).catch(() => {});
  };
  const launch = async s => {
    if (!(await activeRequest(s))) return;
    // The request deadline is persisted as a Chrome alarm, so suspension of the
    // service worker cannot leave a session waiting forever.
    await api.alarms.create('sabet-request:' + requestKey(identity(s)), { when: s.deadline });
    const claimed = await store.claim(identity(s));
    if (!claimed) return;
    void openTab(claimed).catch(error => fail(claimed, error.message));
  };
  const start = async (m, sender) => {
    if (!popupSender(sender)) throw new Error('Mulai dari popup.');
    const tab = await api.tabs.get(m.tabId);
    if (!/^https:\/\//.test(tab.url || '')) throw new Error('Buka halaman kuis HTTPS.');
    if (new URL(tab.url).href !== m.url) throw new Error('Halaman berubah. Buka kembali popup.');
    const old = await store.read();
    if (!terminal(old)) throw new Error('Sesi lain masih berjalan. Hentikan sesi tersebut terlebih dahulu.');
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const probes = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => /\/mod\/quiz\/attempt\.php$/.test(location.pathname) && !!document.querySelector('.que'),
    });
    if (!probes[0]?.result) throw new Error('Buka halaman pengerjaan kuis Moodle.');
    await cleanup(old, true);
    const s = await store.start({ tabId: tab.id, url: tab.url, provider: m.provider, prompt: m.prompt });
    await api.tabs.sendMessage(tab.id, { action: 'START', sessionId: s.id });
    return s;
  };
  const handle = async (m, sender) => {
    if (sender.id !== api.runtime.id) throw new Error('Pengirim tidak dikenali.');
    if (m.action === 'SESSION_START') return start(m, sender);
    const s = await store.read();
    // Tab kuis polling tiap 500 ms; payload (bisa berisi gambar MB-an) hanya untuk tab AI.
    if (m.action === 'SESSION_STATE') return owner(s, sender) ? { ...s, payload: null } : null;
    if (m.action === 'PROVIDER_PAYLOAD') {
      if (terminal(s) || s.phase !== 'waiting_for_answer' || !providerSender(s, sender)) return null;
      return { ...s.payload, ai: s.provider, ...identity(s) };
    }
    if (m.action === 'PROVIDER_SENT') {
      if (s?.phase === 'waiting_for_answer' && sameRequest(s, m) && providerSender(s, sender)) await api.tabs.update(s.tabId, { active: true }).catch(() => {});
      return null;
    }
    if (m.action === 'REFOCUS_LMS') {
      if (s?.phase === 'waiting_for_answer' && sameRequest(s, m) && providerSender(s, sender)) await api.tabs.update(s.tabId, { active: true }).catch(() => {});
      return null;
    }
    if (m.action === 'SOLVER_JSON_RESULT' || m.action === 'PROVIDER_SETUP_FAILED' || m.action === 'SOLVER_TIMEOUT') {
      if (s?.phase !== 'waiting_for_answer' || !sameRequest(s, m) || !providerSender(s, sender)) return null;
      if (m.action === 'SOLVER_JSON_RESULT') await accept(s, m.data);
      else await fail(s, m.error || 'Tab AI belum siap atau tidak memberi jawaban.');
      return null;
    }
    if (m.action === 'STOP_PROCESS') {
      if (s?.id !== m.sessionId || terminal(s)) return s;
      if (!owner(s, sender) && !(providerSender(s, sender) && sameRequest(s, m))) throw new Error('Sesi tidak cocok.');
      const stopped = await store.event(s.id, 'ABORT');
      await cleanup(s, true);
      await notify(stopped);
      return stopped;
    }
    if (!owner(s, sender) || s.id !== m.sessionId) throw new Error('Sesi tidak cocok.');
    if (m.action === 'EDITOR_ACCESS') {
      if (!sender.tab || terminal(s) || m.id !== s.target?.id || sender.tab.url !== s.target.url) throw new Error('Target editor tidak cocok.');
      if (!['ace', 'essay'].includes(m.kind)) throw new Error('Editor tidak didukung.');
      if (m.value !== undefined && s.phase !== 'applying') throw new Error('Pengisian editor belum diizinkan.');
      const results = await api.scripting.executeScript({
        target: { tabId: s.tabId }, world: 'MAIN', func: editorAccess,
        args: [{ id: m.id, kind: m.kind, ...(m.value === undefined ? {} : { value: m.value }) }],
      });
      return results[0]?.result || { ok: false, value: '' };
    }
    if (m.action === 'FETCH_IMAGE') {
      // Hanya untuk soal aktif yang sedang disiapkan, dari tab kuis pemilik sesi.
      if (!sender.tab || !['solving', 'retrying'].includes(s.phase) || sender.tab.url !== s.target?.url) throw new Error('Gambar soal tidak cocok dengan sesi.');
      return fetchImageDataUrl(m.url, { signal: AbortSignal.timeout(25000) });
    }
    if (m.action === 'OPEN_AI') {
      if (sameRequest(s, m) && s.phase === 'waiting_for_answer') await launch(s);
      return null;
    }
    if (m.action === 'SESSION_EVENT') {
      if (m.event === 'QUESTION' && m.target?.url !== sender.tab?.url) throw new Error('Halaman soal berubah.');
      const next = await store.event(s.id, m.event, m);
      if (terminal(next)) await cleanup(s);
      return next;
    }
    throw new Error('Aksi tidak dikenali.');
  };
  const alarm = async a => {
    const s = await store.read();
    if (s?.phase !== 'waiting_for_answer') return;
    if (a.name !== 'sabet-request:' + requestKey(identity(s)) || Date.now() < s.deadline) return;
    await fail(s, 'Batas waktu menunggu jawaban AI tercapai.');
  };
  const tabUpdated = async (tabId, info) => {
    if (info.status !== 'complete') return;
    const s = await store.read();
    if (terminal(s)) return;
    if (tabId === s.tabId) await api.tabs.sendMessage(tabId, { action: 'START', sessionId: s.id }).catch(() => {});
    if (tabId === s.providerTabId) await api.tabs.sendMessage(tabId, { action: 'NEW_PAYLOAD', ...identity(s) }).catch(() => {});
  };
  const tabRemoved = async tabId => {
    const s = await store.read();
    if (terminal(s)) return;
    if (s.tabId === tabId) {
      await store.event(s.id, 'ABORT');
      await cleanup(s, true);
    } else if (s.providerTabId === tabId && s.phase === 'waiting_for_answer') await fail(s, 'Tab AI ditutup sebelum selesai.');
  };
  return { handle, alarm, tabUpdated, tabRemoved, store };
}
