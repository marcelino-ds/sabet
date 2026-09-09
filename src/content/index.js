import { rpc, delay } from '../shared/browser.js';
import { runFlow } from './flow.js';
import { createMoodleAdapter } from './moodle-adapter.js';
import { renderOverlay } from './overlay.js';

function install() {
  if (window.__sabetReady) return;
  window.__sabetReady = true;
  let task = null;
  let controller = null;
  let sessionId = null;
  let overlay = null;

  const read = () => rpc({ action: 'SESSION_STATE' });
  const stop = async () => {
    controller?.abort();
    if (!sessionId) return;
    try {
      const state = await rpc({ action: 'STOP_PROCESS', sessionId });
      overlay?.update(state);
    } catch (error) { overlay?.error(error.message); }
  };
  const start = async () => {
    if (task) return task;
    // Set the latch before the first await: auto-injection and START may arrive
    // together on navigation, but a document must have only one runner.
    task = (async () => {
      const s = await read();
      if (!s || ['done', 'aborted', 'error'].includes(s.phase)) return;
      sessionId = s.id;
      controller = new AbortController();
      overlay ||= renderOverlay(stop);
      const adapter = createMoodleAdapter(s.id);
      await runFlow({
        session: s, adapter, read,
        event: (current, event, data) => rpc({ action: 'SESSION_EVENT', sessionId: current.id, event, ...data }),
        launch: current => rpc({ action: 'OPEN_AI', sessionId: current.id, requestId: current.requestId, questionKey: current.questionKey }),
        signal: controller.signal, pause: delay, status: state => overlay.update(state),
      });
      const final = await read();
      if (final?.id === sessionId) overlay.update(final);
    })().catch(error => overlay?.error(error.message)).finally(() => { task = null; });
    return task;
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.action === 'START') { respond({ ok: true }); void start(); }
    else if (message.action === 'STOP_PROCESS' && message.sessionId === sessionId) {
      controller?.abort();
      respond({ ok: true });
    } else if (message.action === 'SESSION_CHANGED') {
      respond({ ok: true });
      void read().then(s => {
        if (s?.id === sessionId && ['done', 'aborted', 'error'].includes(s.phase)) {
          controller?.abort();
          overlay?.update(s);
        }
      });
    }
  });
  window.addEventListener('pagehide', () => controller?.abort(), { once: true });
  void start();
}
install();
