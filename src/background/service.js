import { createSessionStore } from './session-store.js';
import { getProvider } from '../shared/providers.js';
import { normalizeAnswer } from '../shared/answer-parser.js';
import { solveViaApi } from '../shared/api-client.js';
import { requestKey } from '../shared/session-guard.js';
import { editorAccess } from './editor-access.js';

const terminal = s => !s || ['done', 'aborted', 'error'].includes(s.phase);
const identity = s => ({ sessionId: s.id, requestId: s.requestId, questionKey: s.questionKey });
const sameRequest = (s, m) => s && s.id === m.sessionId && s.requestId === m.requestId && s.questionKey === m.questionKey;

// All durable session mutations pass through this owner. Provider operations run
// outside the mutation queue; identity checks discard their late completions.
export function createBackground(api) {
  const controllers = new Map();
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
    const key = requestKey(identity(s));
    controllers.get(key)?.abort();
    controllers.delete(key);
    await api.alarms.clear('sabet-request:' + key);
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
  const perform = async s => {
    try {
      const provider = getProvider(s.provider);
      if (s.transport === 'api') {
        const cfg = await api.storage.local.get('apiKey_' + s.provider);
        if (!(await activeRequest(s))) return;
        const key = cfg['apiKey_' + s.provider];
        if (!key) { await fail(s, 'API key belum diisi. Isi key atau pilih mode tab AI.'); return; }
        const controller = new AbortController();
        controllers.set(requestKey(identity(s)), controller);
        // A request deadline is also persisted as a Chrome alarm, so suspension
        // of the service worker cannot leave a session waiting forever.
        const timeout = setTimeout(() => controller.abort(), 90000);
        try {
          const selected = { ...provider, api: { ...provider.api, model: s.model || provider.api.model } };
          const answer = await solveViaApi(selected, key, s.payload, { signal: controller.signal });
          await accept(s, answer);
        } finally {
          clearTimeout(timeout);
          controllers.delete(requestKey(identity(s)));
        }
      } else await openTab(s);
    } catch (error) { await fail(s, error.name === 'AbortError' ? 'Permintaan AI dibatalkan atau melewati batas waktu.' : error.message); }
  };
  const launch = async s => {
    if (!(await activeRequest(s))) return;
    await api.alarms.create('sabet-request:' + requestKey(identity(s)), { when: s.deadline });
    const key = requestKey(identity(s));
    const persisted = await store.read();
    if (persisted?.startedRequestId === persisted.requestId && persisted.transport === 'api' && !controllers.has(key)) {
      await store.reclaim(identity(s));
    }
    const claimed = await store.claim(identity(s));
    if (!claimed) return;
    void perform(claimed);
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
    const s = await store.start({ tabId: tab.id, url: tab.url, provider: m.provider, prompt: m.prompt, transport: m.transport, model: m.model });
    await api.tabs.sendMessage(tab.id, { action: 'START', sessionId: s.id });
    return s;
  };
  const handle = async (m, sender) => {
    if (sender.id !== api.runtime.id) throw new Error('Pengirim tidak dikenali.');
    if (m.action === 'SESSION_START') return start(m, sender);
    const s = await store.read();
    if (m.action === 'SESSION_STATE') return owner(s, sender) ? s : null;
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
