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
  it('finds the JSON answer even when a later bubble is prose without JSON', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article>```json\n{"jawaban":"4","index_pilihan":0}\n```</article><article>Jawabannya empat.</article>';
    const ctrl = new AbortController(); let result;
    const pending = driver.waitForAnswer(provider, new Set(), ctrl.signal).then(v => { result = v; });
    await vi.advanceTimersByTimeAsync(2500);
    await pending;
    expect(result.jawaban).toBe('4');
  });
  it('resolves null after the stuck window when prose never becomes JSON', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article>Jawaban berupa prosa saja.</article>';
    const ctrl = new AbortController(); let result;
    const pending = driver.waitForAnswer(provider, new Set(), ctrl.signal, { stuckMs: 25000 }).then(v => { result = v; });
    await vi.advanceTimersByTimeAsync(26000);
    await pending;
    expect(result).toBeNull();
  });
  it('nudges the AI once for the JSON block when it answered in prose', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<textarea></textarea><button class="send">Kirim</button>';
    let sends = 0;
    document.querySelector('button').addEventListener('click', () => {
      sends++;
      const bubble = document.createElement('article');
      bubble.textContent = sends === 1
        ? 'Hasilnya adalah empat.'
        : '```json\n{"jawaban":"4","index_pilihan":0}\n```';
      document.body.appendChild(bubble);
      document.querySelector('textarea').value = '';
    });
    const proseProvider = { editorSelectors: ['textarea'], sendSelectors: ['button.send'], bubbleSelector: 'article' };
    const status = vi.fn(); const sent = vi.fn();
    const run = driver.runProvider(proseProvider, { text: '2+2?' }, new AbortController().signal, status, sent);
    await vi.advanceTimersByTimeAsync(2000);   // prompt masuk, kirim #1, jawaban prosa
    await vi.advanceTimersByTimeAsync(30000);  // jendela stuck 25s → teguran → kirim #2
    await vi.advanceTimersByTimeAsync(3000);   // jawaban JSON stabil
    await expect(run).resolves.toMatchObject({ jawaban: '4' });
    expect(sends).toBe(2);
    expect(status).toHaveBeenCalledWith('Minta format JSON.');
  });
  it('writes the full prompt into a native editor instead of accepting an old draft', async () => {
    expect(driver.writePrompt).toBeTypeOf('function');
    document.body.innerHTML = '<textarea>old draft</textarea>';
    await driver.writePrompt(document.querySelector('textarea'), 'full new question', new AbortController().signal);
    expect(document.querySelector('textarea').value).toBe('full new question');
  });
  it('falls back to paste when the page file input does not attach the image', async () => {
    document.body.innerHTML = '<input type="file" accept="image/*"><div contenteditable="true"></div>';
    const editor = document.querySelector('[contenteditable]');
    let pasted = 0;
    editor.addEventListener('paste', event => { pasted = event.clipboardData.files.length; document.body.append(Object.assign(document.createElement('img'), { className: 'preview' })); });
    await driver.attachImage(editor, 'data:image/png;base64,iVBORw0KGgo=', new AbortController().signal, 50);
    expect(pasted).toBe(1);
  });
  it('stops with an image error instead of sending the question without its image', async () => {
    document.body.innerHTML = '<div contenteditable="true"></div>';
    await expect(driver.attachImage(document.querySelector('[contenteditable]'), 'data:image/png;base64,iVBORw0KGgo=', new AbortController().signal, 20))
      .rejects.toThrow('Gambar soal gagal dilampirkan');
  });
});

describe('writePrompt — editor rich-text', () => {
  it('accepts paragraphs from a rich editor without pasting the prompt twice', async () => {
    document.body.innerHTML = '<div contenteditable="true"></div>';
    const editor = document.querySelector('[contenteditable]');
    let pastes = 0;
    // Seperti ProseMirror: tiap baris jadi <p>, insertText tidak didukung.
    editor.addEventListener('paste', event => {
      pastes++;
      event.preventDefault();
      editor.innerHTML = event.clipboardData.getData('text/plain').split('\n').map(line => `<p>${line}</p>`).join('');
    });
    await driver.writePrompt(editor, 'baris satu\nbaris dua', new AbortController().signal);
    expect(pastes).toBe(1);
    expect(editor.querySelectorAll('p')).toHaveLength(2);
  });
});
