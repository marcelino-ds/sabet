import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderOverlay } from '../src/content/overlay.js';
import { createMoodleAdapter } from '../src/content/moodle-adapter.js';

afterEach(() => { document.getElementById('sabet-ui')?.remove(); document.body.innerHTML = ''; });
describe('user-facing progress overlay', () => {
  it('hides technical phases and request counts while retaining Stop', () => {
    const stop = vi.fn();
    const ui = renderOverlay(stop);
    ui.update({ id: 's1', phase: 'prechecking', dispatches: 15, stats: { solved: 2 } });
    const root = document.getElementById('sabet-ui').shadowRoot;
    expect(root.querySelector('section').textContent).not.toMatch(/precheck|permintaan AI|15/);
    expect(root.querySelector('[role="status"]').textContent).toBe('Memeriksa jawaban');
    root.querySelector('button').click();
    expect(stop).toHaveBeenCalledOnce();
  });
  it('shows a useful error instead of raw exception text', () => {
    const ui = renderOverlay(() => {});
    ui.update({ id: 's1', phase: 'error', error: 'TypeError: undefined ' + 'X'.repeat(2000), stats: {} });
    const root = document.getElementById('sabet-ui').shadowRoot;
    expect(root.textContent).not.toContain('TypeError');
    expect(root.textContent).toContain('Coba lagi dari halaman kuis.');
  });
  it('appears again when a new session starts after closing a completed one', () => {
    const ui = renderOverlay(() => {});
    ui.update({ id: 's1', phase: 'done', stats: { solved: 2 } });
    document.getElementById('sabet-ui').shadowRoot.querySelector('button').click();
    expect(document.getElementById('sabet-ui')).toBeNull();
    ui.update({ id: 's2', phase: 'solving', stats: { solved: 0 } });
    expect(document.getElementById('sabet-ui')).not.toBeNull();
  });
  it('does not replace the user status with editor implementation details while filling', async () => {
    document.body.innerHTML = '<div class="que essay" id="q1"><div class="qtext">Explain</div><div contenteditable="true"></div></div>';
    const ui = renderOverlay(() => {});
    ui.update({ id: 's1', phase: 'applying', stats: {} });
    await createMoodleAdapter().apply(document.querySelector('.que'), { jawaban: 'An answer' });
    const root = document.getElementById('sabet-ui').shadowRoot;
    expect(root.querySelector('[role="status"]').textContent).toBe('Mengisi jawaban');
    expect(document.querySelector('[contenteditable]').textContent).toBe('An answer');
  });
});
