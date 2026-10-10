import { afterEach, describe, expect, it, vi } from 'vitest';
import * as driver from '../src/injector/driver.js';
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
const provider = { bubbleSelector: 'article', sendSelectors: ['button.send'], editorSelectors: ['textarea'], streamingSelector: '[data-streaming=true]' };
describe('provider DOM driver', () => {
  it('waits for streaming to stop and commits the final stable answer', async () => {
    expect(driver.waitForAnswer).toBeTypeOf('function');
    vi.useFakeTimers();
    document.body.innerHTML = '<article data-streaming="true">{"jawaban":"draft"}</article>';
    const ctrl = new AbortController(); let result;
    const pending = driver.waitForAnswer(provider, new Set(), ctrl.signal).then(v => { result = v; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(result).toBeUndefined();
    document.querySelector('article').textContent = '{"jawaban":"final"}';
    document.querySelector('article').removeAttribute('data-streaming');
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(result.jawaban).toBe('final');
  });
  it('does not accept a stale answer from before this request', async () => {
    expect(driver.waitForAnswer).toBeTypeOf('function');
    vi.useFakeTimers();
    document.body.innerHTML = '<article>{"jawaban":"old"}</article>';
    const ctrl = new AbortController();
    const pending = driver.waitForAnswer(provider, new Set(document.querySelectorAll('article')), ctrl.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(2000);
    ctrl.abort(); await assertion;
  });
  it('writes the full prompt into a native editor instead of accepting an old draft', async () => {
    expect(driver.writePrompt).toBeTypeOf('function');
    document.body.innerHTML = '<textarea>old draft</textarea>';
    await driver.writePrompt(document.querySelector('textarea'), 'full new question', new AbortController().signal);
    expect(document.querySelector('textarea').value).toBe('full new question');
  });
});
