import { rpc } from '../shared/browser.js';
import { getProviderByHost } from '../shared/providers.js';
import { runProvider } from './driver.js';
import { createStatusWidget } from '../shared/status-widget.js';
import { friendlyError } from '../shared/ui-copy.js';

function install() {
  if (window.__sabetInjectorReady) return;
  window.__sabetInjectorReady = true;
  const seen = new Set();
  let controller;
  let current;
  const consume = async () => {
    let payload;
    let panel;
    try {
      payload = await rpc({ action: 'PROVIDER_PAYLOAD' });
      if (!payload || seen.has(payload.requestId)) return;
      seen.add(payload.requestId);
      const provider = getProviderByHost(location.hostname);
      if (!provider || provider.id !== payload.ai) return;
      controller?.abort();
      controller = new AbortController();
      current = payload;
      const identity = { sessionId: payload.sessionId, requestId: payload.requestId, questionKey: payload.questionKey };
      panel = createStatusWidget({ id: 'sabet-provider', side: 'left', stop: async () => {
        controller.abort();
        try {
          await rpc({ action: 'STOP_PROCESS', ...identity });
          panel.show({ title: 'Berhenti', finished: true });
        } catch (error) {
          panel.show({ title: 'Error', detail: friendlyError(error.message), tone: 'error' });
        }
      } });
      const status = (title = 'Nunggu AI') => panel.show({ title, tone: 'working' });
      const data = await runProvider(provider, payload, controller.signal, status, () => rpc({ action: 'PROVIDER_SENT', ...identity }));
      controller.signal.throwIfAborted();
      await rpc({ action: 'SOLVER_JSON_RESULT', ...identity, data });
      panel.show({ title: 'Jawaban siap', finished: true, tone: 'done' });
    } catch (error) {
      if (controller?.signal.aborted || !payload) return;
      panel?.show({ title: 'Error', detail: friendlyError(error.message), tone: 'error', finished: true });
      await rpc({ action: 'PROVIDER_SETUP_FAILED', sessionId: payload.sessionId, requestId: payload.requestId, questionKey: payload.questionKey, error: error.message }).catch(() => {});
    }
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.action === 'NEW_PAYLOAD') { respond({ ok: true }); void consume(); }
    if (message.action === 'STOP_PROCESS' && message.requestId === current?.requestId) { controller?.abort(); respond({ ok: true }); }
  });
  window.addEventListener('pagehide', () => controller?.abort(), { once: true });
  void consume();
}
install();
