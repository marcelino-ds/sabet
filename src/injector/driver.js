import { delay } from '../shared/browser.js';
import { parseAnswerFromText } from '../shared/answer-parser.js';
import { buildAutoSolveRules } from '../shared/solve-contract.js';
import { createStableAnswerGate } from '../shared/answer-stability.js';

const text = el => el?.matches('textarea,input') ? el.value : el?.innerText || el?.textContent || '';
const visible = el => el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
const first = selectors => selectors.flatMap(s => [...document.querySelectorAll(s)]).find(visible);
const STOP = 'button[aria-label*="stop" i], button[aria-label*="hentikan" i], button[data-testid="stop-button"], [data-is-streaming="true"]';

async function waitFor(read, ms, signal) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    signal.throwIfAborted();
    const value = read();
    if (value) return value;
    await delay(150, signal);
  }
  throw new Error('Elemen AI belum siap. Periksa login atau coba kembali.');
}

export async function writePrompt(editor, prompt, signal) {
  signal.throwIfAborted();
  editor.focus();
  const normalize = value => String(value).replace(/\r\n?/g, '\n').trim();
  const verified = () => normalize(text(editor)) === normalize(prompt) ||
    (!editor.matches('textarea,input') && normalize(editor.textContent) === normalize(prompt));
  if (editor.matches('textarea,input')) {
    const proto = editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(editor, prompt);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    try { document.execCommand('insertText', false, prompt); } catch { /* try paste next */ }
    if (!verified()) {
      const data = new DataTransfer(); data.setData('text/plain', prompt);
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    }
    if (!verified()) {
      editor.textContent = prompt;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    }
  }
  await delay(250, signal);
  if (!verified()) throw new Error('Prompt tidak masuk dengan lengkap. Pengiriman dihentikan.');
}

export function waitForAnswer(provider, previous, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    let scheduled;
    let observer;
    let timer;
    let ticker;
    const read = () => {
      const nodes = [...document.querySelectorAll(provider.bubbleSelector)].filter(n => !previous.has(n));
      const node = nodes.at(-1);
      const content = text(node);
      const streaming = [...document.querySelectorAll(provider.streamingSelector || STOP)].some(visible);
      return { content, answer: streaming ? null : parseAnswerFromText(content) };
    };
    const finish = (error, answer) => {
      if (done) return;
      done = true;
      gate.cancel(); observer?.disconnect(); clearTimeout(timer); clearTimeout(scheduled); clearInterval(ticker);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(answer);
    };
    const gate = createStableAnswerGate(1200, candidate => {
      const current = read();
      if (!current.answer || JSON.stringify(current.answer) !== JSON.stringify(candidate)) { gate.observe(current.content, current.answer); return; }
      finish(null, candidate);
    });
    const inspect = () => {
      if (done) return;
      const current = read();
      gate.observe(current.content, current.answer);
    };
    const abort = () => finish(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    observer = new MutationObserver(() => {
      if (scheduled || done) return;
      scheduled = setTimeout(() => { scheduled = null; inspect(); }, 100);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    timer = setTimeout(() => finish(new Error('AI tidak memberi jawaban dalam 4 menit.')), 240000);
    ticker = setInterval(inspect, 1000);
    inspect();
  });
}

export async function runProvider(provider, payload, signal, status, sent) {
  const editor = await waitFor(() => first(provider.editorSelectors), 20000, signal);
  const prompt = [payload.prompt, payload.text, buildAutoSolveRules()].filter(Boolean).join('\n\n');
  status('Nyiapin soal.');
  if (payload.dataUrl) {
    const previews = new Set(document.querySelectorAll('img, [data-testid*="attachment"], [class*="attachment"]'));
    const match = /^data:([^;]+);base64,(.+)$/.exec(payload.dataUrl);
    if (!match) throw new Error('Data gambar tidak valid.');
    const bytes = Uint8Array.from(atob(match[2]), ch => ch.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'sabet-question.png', { type: match[1] }));
    const input = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
    if (input) { input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); }
    else { editor.focus(); editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true })); }
    await waitFor(() => [...document.querySelectorAll('img, [data-testid*="attachment"], [class*="attachment"]')].find(n => !previews.has(n)), 15000, signal);
  }
  await writePrompt(first(provider.editorSelectors) || editor, prompt, signal);
  const previous = new Set(document.querySelectorAll(provider.bubbleSelector));
  const button = await waitFor(() => provider.sendSelectors.flatMap(sel => [...document.querySelectorAll(sel)]).find(b =>
    visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !/stop|cancel|hentikan|mic|voice/i.test(b.getAttribute('aria-label') || '')
  ), 10000, signal);
  signal.throwIfAborted();
  button.click();
  await waitFor(() => !text(first(provider.editorSelectors)).trim() || [...document.querySelectorAll(provider.bubbleSelector)].some(n => !previous.has(n)), 10000, signal);
  await sent();
  status('Nunggu jawaban AI.');
  return waitForAnswer(provider, previous, signal);
}
