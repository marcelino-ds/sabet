import { delay } from '../shared/browser.js';
import { parseAnswerFromText } from '../shared/answer-parser.js';
import { buildAutoSolveRules } from '../shared/solve-contract.js';
import { createStableAnswerGate } from '../shared/answer-stability.js';

const text = el => el?.matches('textarea,input') ? el.value : el?.innerText || el?.textContent || '';
const visible = el => el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
const first = selectors => selectors.flatMap(s => [...document.querySelectorAll(s)]).find(visible);
const STOP = 'button[aria-label*="stop" i], button[aria-label*="hentikan" i], button[data-testid="stop-button"], [data-is-streaming="true"]';

async function poll(read, ms, signal) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    signal.throwIfAborted();
    const value = read();
    if (value) return value;
    await delay(150, signal);
  }
  return null;
}

async function waitFor(read, ms, signal) {
  const value = await poll(read, ms, signal);
  if (value) return value;
  throw new Error('Elemen AI belum siap. Periksa login atau coba kembali.');
}

const ATTACHMENT = 'img, [data-testid*="attachment" i], [class*="attachment" i], [data-testid*="file-thumbnail" i], [class*="file-preview" i], [class*="uploader-file" i]';

// Situs AI menerima gambar lewat jalur berbeda (input file, paste, drop) dan bisa
// berubah sewaktu-waktu. Coba satu per satu sampai pratinjau lampiran muncul; jangan
// diam-diam kirim soal tanpa gambar.
export async function attachImage(editor, dataUrl, signal, waitMs = 5000) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Data gambar tidak valid.');
  const bytes = Uint8Array.from(atob(match[2]), ch => ch.charCodeAt(0));
  const extension = match[1].split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const transfer = () => {
    const data = new DataTransfer();
    data.items.add(new File([bytes], `sabet-soal.${extension}`, { type: match[1] }));
    return data;
  };
  const previews = new Set(document.querySelectorAll(ATTACHMENT));
  const attempts = [
    () => {
      const input = [...document.querySelectorAll('input[type="file"]')]
        .find(el => !el.disabled && (!el.accept || /image|\*/.test(el.accept)));
      if (!input) return false;
      input.files = transfer().files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    () => {
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer(), bubbles: true, cancelable: true }));
    },
    () => {
      const data = transfer();
      for (const type of ['dragenter', 'dragover', 'drop']) editor.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
    },
  ];
  const attached = () => [...document.querySelectorAll(ATTACHMENT)].find(node => !previews.has(node) && !editor.contains(node));
  for (const attempt of attempts) {
    if (attempt() === false) continue;
    if (await poll(attached, waitMs, signal)) return;
  }
  throw new Error('Gambar soal gagal dilampirkan ke tab AI. Coba AI lain.');
}

export async function writePrompt(editor, prompt, signal) {
  signal.throwIfAborted();
  editor.focus();
  // Editor rich-text memecah baris jadi <p>, jadi innerText bisa punya "\n\n" di
  // tempat "\n". Yang diverifikasi kelengkapan teksnya, bukan bentuk spasinya.
  const normalize = value => String(value).replace(/\s+/g, ' ').trim();
  const compact = value => String(value).replace(/\s+/g, '');
  const verified = () => normalize(text(editor)) === normalize(prompt) ||
    (!editor.matches('textarea,input') && compact(editor.textContent) === compact(prompt));
  const selectAll = () => {
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  };
  if (editor.matches('textarea,input')) {
    const proto = editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(editor, prompt);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    selectAll();
    try { document.execCommand('insertText', false, prompt); } catch { /* try paste next */ }
    if (!verified()) {
      // Pilih ulang agar paste mengganti sisa insertText, bukan menempel di belakangnya.
      selectAll();
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

export function waitForAnswer(provider, previous, signal, options = {}) {
  const { timeoutMs = 240000, stuckMs = 0 } = options;
  return new Promise((resolve, reject) => {
    let done = false;
    let scheduled;
    let observer;
    let timer;
    let ticker;
    let stableContent = '';
    let stableAt = 0;
    const read = () => {
      const nodes = [...document.querySelectorAll(provider.bubbleSelector)].filter(n => !previous.has(n));
      const streaming = [...document.querySelectorAll(provider.streamingSelector || STOP)].some(visible);
      // Gabungkan SEMUA bubble baru: jawaban bisa terpecah beberapa pesan, dan
      // bubble "berpikir"/prosa di akhir tidak boleh menutupi JSON jawaban di
      // bubble sebelumnya. Ekstraktor tetap ambil blok JSON terakhir.
      const content = nodes.map(text).join('\n\n');
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
      if (stuckMs > 0) {
        // Teks ada, stabil, tapi tak pernah jadi JSON → serahkan ke pemanggil
        // (untuk menegur AI minta format) alih-alih menunggu timeout penuh.
        if (current.content && current.content === stableContent) {
          if (!current.answer && Date.now() - stableAt >= stuckMs) { finish(null, null); return; }
        } else {
          stableContent = current.content;
          stableAt = Date.now();
        }
      }
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
    timer = setTimeout(() => finish(new Error('AI tidak memberi jawaban tepat waktu.')), timeoutMs);
    ticker = setInterval(inspect, 1000);
    inspect();
  });
}

// Tombol kirim baru aktif setelah unggahan gambar selesai / prompt masuk.
async function clickSend(provider, waitMs, signal) {
  const button = await waitFor(() => provider.sendSelectors.flatMap(sel => [...document.querySelectorAll(sel)]).find(b =>
    visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !/stop|cancel|hentikan|mic|voice/i.test(b.getAttribute('aria-label') || '')
  ), waitMs, signal);
  signal.throwIfAborted();
  button.click();
}

const JSON_NUDGE = [
  'Jawabanmu belum berisi blok JSON yang diminta.',
  'Kirim ulang jawaban akhirmu secara ringkas, lalu tutup dengan TEPAT SATU blok JSON:',
  '```json',
  '{ "jawaban": <teks/array/kode>, "index_pilihan": <nomor> }',
  '```',
  'Tanpa teks apa pun setelah blok JSON itu.',
].join('\n');

export async function runProvider(provider, payload, signal, status, sent) {
  const editor = await waitFor(() => first(provider.editorSelectors), 20000, signal);
  const prompt = [payload.prompt, payload.text, buildAutoSolveRules()].filter(Boolean).join('\n\n');
  status('Nyiapin soal.');
  if (payload.dataUrl) {
    status('Ngelampirin gambar.');
    await attachImage(editor, payload.dataUrl, signal);
  }
  await writePrompt(first(provider.editorSelectors) || editor, prompt, signal);
  const previous = new Set(document.querySelectorAll(provider.bubbleSelector));
  await clickSend(provider, payload.dataUrl ? 60000 : 10000, signal);
  await waitFor(() => !text(first(provider.editorSelectors)).trim() || [...document.querySelectorAll(provider.bubbleSelector)].some(n => !previous.has(n)), 10000, signal);
  await sent();
  status('Nunggu jawaban AI.');
  let answer = await waitForAnswer(provider, previous, signal, { stuckMs: 25000 });
  if (!answer) {
    // AI menjawab tanpa blok JSON (prosa saja). Tegur di percakapan yang sama —
    // jauh lebih cepat daripada dispatch baru yang mengulang unggah soal/gambar.
    const nudgeEditor = first(provider.editorSelectors);
    if (!nudgeEditor) throw new Error('AI tidak memberi jawaban JSON yang diminta.');
    status('Minta format JSON.');
    await writePrompt(nudgeEditor, JSON_NUDGE, signal);
    await clickSend(provider, 10000, signal);
    answer = await waitForAnswer(provider, previous, signal, { timeoutMs: 180000 });
    if (!answer) throw new Error('AI tidak memberi jawaban JSON yang diminta.');
  }
  return answer;
}
