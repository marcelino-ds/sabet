import { sessionCopy, friendlyError } from '../shared/ui-copy.js';
import { createStatusWidget } from '../shared/status-widget.js';

export function renderOverlay(stop) {
  const panel = createStatusWidget({ id: 'sabet-ui', stop });
  let sessionId = null;
  return {
    update(s) {
      if (!s) return;
      const copy = sessionCopy(s);
      const finished = ['done', 'aborted', 'error'].includes(s.phase);
      const count = Math.max(0, Math.floor(Number(s.stats?.solved) || 0));
      panel.show({
        title: copy.title,
        detail: finished ? copy.detail : count ? count + ' soal kelar' : '',
        tone: copy.tone,
        finished,
        revive: s.id !== sessionId,
      });
      sessionId = s.id;
    },
    error(error) {
      panel.show({ title: 'Error', detail: friendlyError(error), tone: 'error' });
    },
  };
}
