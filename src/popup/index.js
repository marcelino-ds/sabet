import { rpc } from '../shared/browser.js';
import { PROVIDERS, DEFAULT_PROVIDER } from '../shared/providers.js';
import { sessionCopy, friendlyError } from '../shared/ui-copy.js';

const $ = id => document.getElementById(id);
let provider = DEFAULT_PROVIDER;
let currentSession = null;
let targetTab = null;
let busy = false;
let savedPrompt = '';
const active = s => s && !['done', 'aborted', 'error'].includes(s.phase);

const icons = {
  gemini: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z"/></svg>',
  chatgpt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a5 5 0 0 1 4.8 3.5 5 5 0 0 1 3 7.9 5 5 0 0 1-5.4 6.3A5 5 0 0 1 6.5 18a5 5 0 0 1-2.9-7.9A5 5 0 0 1 12 3Z"/><path d="m8 8 7-1 3 6-5 5-7-3 1-7 6-3m-5 4 7 4-2 5m2-11-1 6-7 2"/></svg>',
  claude: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1 7 4-6-2 7 7-2-6 4 6 3-7-1 2 7-4-6-1 7-1-7-5 5 3-6-7 1 6-3-6-3 7 1-3-7 5 6Z"/></svg>',
};

function status(message = '', tone = '') {
  $('status').textContent = message;
  $('status').hidden = !message;
  $('status').dataset.tone = tone;
}
function fail(error) { status(friendlyError(error?.message || error), 'error'); }

function renderControls() {
  const running = active(currentSession);
  $('sendBtn').hidden = !!running;
  $('stopBtn').hidden = !running;
  $('sendBtn').disabled = busy || !targetTab;
  $('stopBtn').disabled = busy;
  $('stopLabel').textContent = busy && running ? 'Berhenti...' : 'Hentikan';
  $('sendLabel').textContent = busy ? 'Bentar...' : currentSession ? 'Mulai lagi' : 'Mulai';
  $('providerGroup').disabled = running || busy;
  $('providerGroup').hidden = !!running;
  $('prompt').disabled = running || busy;
  $('prompt').hidden = !!running;
  document.querySelector('.prompt-label').hidden = !!running;
  // Setelah sesi selesai, tetap jelaskan kenapa "Mulai lagi" mati di luar halaman soal.
  $('pagePanel').hidden = !!running || (!!currentSession && !!targetTab);
}
function displayProvider() {
  document.querySelectorAll('input[name="provider"]').forEach(input => { input.checked = input.value === provider; });
}

async function saveSettings() {
  const patch = { lastProvider: provider, prompt: $('prompt').value };
  await chrome.storage.local.set(patch);
  savedPrompt = patch.prompt;
}
function showSession(s) {
  currentSession = s || null;
  $('sessionPanel').hidden = !s;
  if (s) {
    const copy = sessionCopy(s);
    $('sessionPanel').dataset.tone = copy.tone;
    $('sessionPhase').textContent = copy.title;
    $('sessionDetail').textContent = s.phase === 'error' ? '' : copy.detail;
    $('sessionDetail').hidden = s.phase === 'error';
    $('sessionError').textContent = s.phase === 'error' ? copy.detail : '';
    $('sessionError').hidden = s.phase !== 'error';
    const count = Math.max(0, Math.floor(Number(s.stats?.solved) || 0));
    $('sessionStats').textContent = count + ' soal kelar';
    $('sessionStats').hidden = count === 0 || s.phase === 'done';
  }
  renderControls();
}

async function init() {
  const settings = await chrome.storage.local.get(['lastProvider', 'prompt']);
  provider = PROVIDERS[settings.lastProvider] ? settings.lastProvider : DEFAULT_PROVIDER;
  for (const p of Object.values(PROVIDERS)) {
    const label = document.createElement('label');
    label.className = 'provider-choice';
    label.innerHTML = '<input type="radio" name="provider"><span class="provider-symbol" aria-hidden="true"></span><span class="provider-name"></span><span class="selection-dot" aria-hidden="true"></span>';
    label.querySelector('input').value = p.id;
    label.querySelector('.provider-name').textContent = p.label;
    label.querySelector('.provider-symbol').innerHTML = icons[p.id];
    $('providerOptions').appendChild(label);
  }
  $('prompt').value = settings.prompt || '';
  savedPrompt = $('prompt').value;
  displayProvider();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && /^https:\/\//.test(tab.url || '')) {
    const probe = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => /\/mod\/quiz\/attempt\.php$/.test(location.pathname) && !!document.querySelector('.que'),
    }).catch(() => []);
    if (probe[0]?.result) targetTab = tab;
  }
  $('platformBadge').textContent = targetTab ? 'Soalnya kebuka' : 'Bukan halaman soal';
  $('pageHint').textContent = targetTab ? 'Pilih AI, terus mulai.' : 'Buka halaman soalnya.';
  $('pagePanel').dataset.ready = String(!!targetTab);
  showSession(await rpc({ action: 'SESSION_STATE' }));
}

$('providerOptions').addEventListener('change', event => {
  const chosen = event.target.value;
  if (!PROVIDERS[chosen] || active(currentSession)) return;
  provider = chosen;
  displayProvider();
  void chrome.storage.local.set({ lastProvider: provider }).catch(fail);
});
$('prompt').addEventListener('blur', () => {
  if ($('prompt').value === savedPrompt) return;
  const prompt = $('prompt').value;
  void chrome.storage.local.set({ prompt }).then(() => { savedPrompt = prompt; }).catch(fail);
});
$('sendBtn').addEventListener('click', async () => {
  if (!targetTab || busy || active(currentSession)) return;
  busy = true;
  status();
  renderControls();
  try {
    await saveSettings();
    const s = await rpc({
      action: 'SESSION_START', tabId: targetTab.id, url: targetTab.url, provider, prompt: $('prompt').value,
    }, 20000);
    showSession(s);
  } catch (error) { fail(error); }
  finally { busy = false; renderControls(); }
});
$('stopBtn').addEventListener('click', async () => {
  if (!active(currentSession) || busy) return;
  busy = true;
  status();
  renderControls();
  try { showSession(await rpc({ action: 'STOP_PROCESS', sessionId: currentSession.id })); }
  catch (error) { fail(error); }
  finally { busy = false; renderControls(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sabetSession) showSession(changes.sabetSession.newValue);
});
void init().catch(fail);
