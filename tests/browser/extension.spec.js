import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { localNetwork } from './local-network.js';

const lmsUrl = 'https://lms.test/mod/quiz/attempt.php?attempt=1';
const quiz = '<!doctype html><html><body class="path-mod-quiz"><form id="responseform">' +
  '<div class="que shortanswer notyetanswered" id="q1"><div class="qtext">2+2</div><div class="answer"><input type="text" name="a1"></div></div>' +
  '<div class="que shortanswer notyetanswered" id="q2"><div class="qtext">3+3</div><div class="answer"><input type="text" name="a2"></div></div>' +
  '<button name="finishattempt" type="button" onclick="window.finalClicked=true">Submit all and finish</button></form></body></html>';
const provider = `<!doctype html><html><body>
<textarea id="prompt-textarea"></textarea><div contenteditable="true" class="ql-editor"></div>
<button aria-label="Send message" onclick="send()">Send</button>
<script>
window.sends = 0;
function send() {
  window.sends++;
  const prompt = document.querySelector('.ql-editor').textContent;
  document.querySelector('.ql-editor').textContent = '';
  const button = document.querySelector('button');
  button.setAttribute('aria-label', 'Stop response'); button.textContent = 'Stop';
  const bubble = document.createElement('model-response'); document.body.appendChild(bubble);
  bubble.textContent = JSON.stringify({jawaban: 'draft', index_pilihan: 0});
  setTimeout(() => {
    bubble.textContent = JSON.stringify({jawaban: prompt.includes('2+2') ? '4' : '6', index_pilihan: 0});
    button.setAttribute('aria-label','Send message'); button.textContent = 'Send';
  }, 2200);
}
</script></body></html>`;

async function launch(options = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'sabet-browser-'));
  const network = await localNetwork((host, url) => options.resource?.(host, url) ??
    (host === 'lms.test' ? options.quiz || quiz : host === 'gemini.google.com' ? options.provider || provider : null));
  let context;
  try {
    const extension = resolve('dist');
    context = await chromium.launchPersistentContext(dir, {
      channel: 'chromium', headless: true, executablePath: process.env.SABET_BROWSER_PATH || undefined,
      viewport: options.viewport,
      proxy: { server: network.url }, ignoreHTTPSErrors: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--ignore-certificate-errors', '--disable-quic'],
    });
    let [worker] = context.serviceWorkers();
    worker ||= await context.waitForEvent('serviceworker');
    return { context, worker, id: worker.url().split('/')[2], close: async () => { await context.close(); await network.close(); await rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await context?.close(); await network.close(); await rm(dir, { recursive: true, force: true }); throw error; }
}

async function start(f) {
  const page = await f.context.newPage(); await page.goto(lmsUrl);
  const popup = await f.context.newPage(); await popup.goto(`chrome-extension://${f.id}/popup.html`);
  const response = await popup.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === url);
    return chrome.runtime.sendMessage({ action: 'SESSION_START', tabId: tab.id, url, provider: 'gemini' });
  }, lmsUrl);
  expect(response.ok, response.error).toBe(true);
  return { page, popup };
}
const read = f => f.worker.evaluate(async () => (await chrome.storage.local.get('sabetSession')).sabetSession);

test('loads popup with only the tab-AI controls and no page errors', async () => {
  const f = await launch();
  try {
    const page = await f.context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`chrome-extension://${f.id}/popup.html`);
    await expect(page.locator('.brand')).toHaveText('Sabet');
    await expect(page.locator('input[name="provider"]')).toHaveCount(3);
    await expect(page.locator('.version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.locator('#settingsBtn, #transport, #apiKey, #model')).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const fonts = await document.fonts.load('400 14px Figtree');
      return fonts.length > 0 && fonts.every(font => font.status === 'loaded');
    })).toBe(true);
    expect(errors).toEqual([]);
    await page.locator('body').screenshot({ path: 'test-results/sabet-home.png', animations: 'disabled' });
  } finally { await f.close(); }
});

test('opens the toolbar popup at a usable size and keeps its controls inside the window', async () => {
  const f = await launch({ viewport: null });
  try {
    // Inspect the native action view from a separate extension tab without resizing it.
    const observer = await f.context.newPage();
    await observer.goto(`chrome-extension://${f.id}/popup.html`);
    const tab = await f.context.newPage();
    await tab.goto(lmsUrl);
    await tab.bringToFront();
    const layout = selector => observer.evaluate(selector => {
      const popup = chrome.extension.getViews({ type: 'popup' })[0];
      if (!popup) return null;
      const element = popup.document.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return {
        width: popup.innerWidth, height: popup.innerHeight,
        visible: !!box?.width && !!box?.height && box.left >= 0 && box.top >= 0 &&
          box.right <= popup.innerWidth && box.bottom <= popup.innerHeight,
      };
    }, selector);
    for (let opening = 0; opening < 2; opening++) {
      await f.worker.evaluate(() => chrome.action.openPopup());
      await observer.waitForFunction(() => {
        const popup = chrome.extension.getViews({ type: 'popup' })[0];
        return popup?.document.readyState === 'complete' && popup.document.querySelectorAll('input[name="provider"]').length === 3;
      });
      const size = await layout('.brand');
      expect(size.width).toBeGreaterThanOrEqual(300);
      expect(size.height).toBeGreaterThanOrEqual(400);
      for (const selector of ['.brand', '#providerOptions', '#prompt', '#sendBtn']) {
        expect((await layout(selector))?.visible, `${selector} fits in the toolbar popup`).toBe(true);
      }
      await observer.evaluate(() => chrome.extension.getViews({ type: 'popup' })[0].close());
      await expect.poll(() => observer.evaluate(() => chrome.extension.getViews({ type: 'popup' }).length)).toBe(0);
    }
  } finally { await f.close(); }
});

test('keeps the primary action visible in a short popup', async () => {
  const f = await launch();
  try {
    const page = await f.context.newPage();
    await page.setViewportSize({ width: 360, height: 400 });
    await page.goto(`chrome-extension://${f.id}/popup.html`);
    const box = await page.locator('#sendBtn').boundingBox();
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  } finally { await f.close(); }
});

test('shows a concise actionable error and keeps Stop reachable without internal history', async () => {
  const f = await launch();
  try {
    const page = await f.context.newPage();
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto(`chrome-extension://${f.id}/popup.html`);
    await f.worker.evaluate(() => chrome.storage.local.set({ sabetSession: {
      id: 'ui-preview', phase: 'prechecking', stats: { solved: 3 }, dispatches: 22,
      history: Array.from({ length: 60 }, () => ({ phase: 'waiting_for_answer', at: Date.now() })),
    } }));
    await expect(page.locator('#stopBtn')).toBeVisible();
    await expect(page.locator('#providerGroup')).toBeHidden();
    await expect(page.locator('#prompt')).toBeHidden();
    const box = await page.locator('#stopBtn').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(400);
    await expect(page.locator('body')).not.toContainText(/precheck|permintaan|riwayat|waiting_for_answer/i);
    await page.locator('body').screenshot({ path: 'test-results/sabet-running.png', animations: 'disabled' });
    await f.worker.evaluate(() => chrome.storage.local.set({ sabetSession: {
      id: 'ui-preview', phase: 'error', stats: { solved: 3 }, error: 'TypeError: undefined provider ' + 'X'.repeat(2000),
    } }));
    await expect(page.locator('#sessionError')).toHaveText('Nggak bisa lanjut.');
    await expect(page.locator('body')).not.toContainText('TypeError');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('body').screenshot({ path: 'test-results/sabet-error.png', animations: 'disabled' });
  } finally { await f.close(); }
});

test('keeps both page overlays inside a narrow viewport with a reachable Stop button', async () => {
  const f = await launch();
  try {
    const { page } = await start(f);
    await page.setViewportSize({ width: 260, height: 200 });
    await expect(page.locator('#sabet-ui')).toBeVisible();
    await expect.poll(() => f.context.pages().some(p => p.url().startsWith('https://gemini.google.com/'))).toBe(true);
    const providerPage = f.context.pages().find(p => p.url().startsWith('https://gemini.google.com/'));
    await providerPage.setViewportSize({ width: 260, height: 200 });
    await expect(providerPage.locator('#sabet-provider')).toBeVisible();
    for (const [surface, selector] of [[page, '#sabet-ui'], [providerPage, '#sabet-provider']]) {
      const panel = surface.locator(selector);
      const box = await panel.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(260);
      expect(box.y + box.height).toBeLessThanOrEqual(200);
      await expect(panel.getByRole('button', { name: 'Hentikan', exact: true })).toBeVisible();
      await expect(panel.locator('section')).not.toContainText(/permintaan|precheck|request|payload|undefined/i);
      await surface.screenshot({ path: selector === '#sabet-ui' ? 'test-results/sabet-overlay.png' : 'test-results/sabet-ai-overlay.png' });
    }
    await providerPage.locator('#sabet-provider').getByRole('button', { name: 'Hentikan', exact: true }).click();
    await expect.poll(async () => (await read(f))?.phase).toBe('aborted');
  } finally { await f.close(); }
});

test('starts from the popup controls and remembers the chosen AI and note', async () => {
  const f = await launch();
  try {
    const quizPage = await f.context.newPage();
    await quizPage.goto(lmsUrl);
    const popup = await f.context.newPage();
    await popup.goto(`chrome-extension://${f.id}/popup.html`);
    await quizPage.bringToFront();
    await popup.reload();
    await expect(popup.locator('#platformBadge')).toHaveText('Soalnya kebuka');
    await expect(popup.locator('#sendBtn')).toBeEnabled();
    await popup.locator('body').screenshot({ path: 'test-results/sabet-ready.png', animations: 'disabled' });
    await popup.getByRole('radio', { name: 'Claude', exact: true }).check();
    await popup.getByRole('radio', { name: 'Gemini', exact: true }).check();
    await popup.locator('#prompt').fill('Jawab dalam bahasa Indonesia.');
    await popup.getByRole('button', { name: 'Mulai', exact: true }).click();
    await expect(popup.locator('#stopBtn')).toBeVisible();
    const s = await read(f);
    expect(s.prompt).toBe('Jawab dalam bahasa Indonesia.');
    expect(s.provider).toBe('gemini');
    expect(s).not.toHaveProperty('transport');
    await popup.getByRole('button', { name: 'Hentikan', exact: true }).click();
    await expect(popup.locator('#sessionPhase')).toHaveText('Berhenti');
    const prefs = await f.worker.evaluate(() => chrome.storage.local.get(['lastProvider', 'prompt']));
    expect(prefs).toEqual({ lastProvider: 'gemini', prompt: 'Jawab dalam bahasa Indonesia.' });
  } finally { await f.close(); }
});

test('resumes after Moodle reload while AI is thinking without a duplicate request', async () => {
  const f = await launch();
  try {
    const { page } = await start(f);
    await expect.poll(async () => (await read(f))?.phase).toBe('waiting_for_answer');
    await page.reload();
    await expect.poll(async () => (await read(f))?.phase, { timeout: 25000 }).toBe('done');
    expect((await read(f)).dispatches).toBe(2);
    await expect(page.locator('[name=a1]')).toHaveValue('4');
  } finally { await f.close(); }
});

test('fills Ace in MAIN world and resumes PRECHECK and CHECK reloads', async () => {
  const codeQuiz = `<!doctype html><html><body class="path-mod-quiz">
  <div class="que coderunner notyetanswered" id="q1"><div class="qtext">2+2</div>
  <div class="info"><div class="state">Not yet answered</div></div>
  <div class="answer"><div class="ace_editor"></div><textarea name="answer" style="display:none"></textarea></div>
  <div class="precheck-results"></div>
  <button type="button" onclick="sessionStorage.pre=Number(sessionStorage.pre||0)+1;location.reload()">Precheck</button>
  <button type="button" onclick="sessionStorage.check=Number(sessionStorage.check||0)+1;location.reload()">Check</button></div>
  <button name="finishattempt" type="button" onclick="window.finalClicked=true">Submit all and finish</button>
  <script>
  let code = sessionStorage.code || 'template';
  document.querySelector('textarea').value = code;
  document.querySelector('.ace_editor').env = {editor:{getValue:()=>code,setValue:v=>{code=v;sessionStorage.code=v},clearSelection:()=>{}}};
  if(sessionStorage.pre) document.querySelector('.precheck-results').textContent='Precheck finished';
  if(sessionStorage.check) document.querySelector('.state').textContent='Correct';
  </script></body></html>`;
  const f = await launch({ quiz: codeQuiz });
  try {
    const { page } = await start(f);
    await expect.poll(async () => (await read(f))?.phase, { timeout: 25000 }).toBe('done');
    expect((await read(f)).dispatches).toBe(1);
    expect((await read(f)).stats.correct).toBe(1);
    expect(await page.evaluate(() => ({ code: sessionStorage.code, pre: sessionStorage.pre, check: sessionStorage.check })))
      .toEqual({ code: '4', pre: '1', check: '1' });
    expect(await page.evaluate(() => window.finalClicked)).toBeUndefined();
  } finally { await f.close(); }
});

test('stops when a user edits a field during an AI request', async () => {
  const f = await launch();
  try {
    const { page } = await start(f);
    await expect.poll(async () => (await read(f))?.phase).toBe('waiting_for_answer');
    await page.locator('[name=a1]').fill('my answer');
    await expect.poll(async () => (await read(f))?.phase, { timeout: 15000 }).toBe('error');
    await expect(page.locator('[name=a1]')).toHaveValue('my answer');
    await expect(page.locator('[name=a2]')).toHaveValue('');
  } finally { await f.close(); }
});

test('fills two questions through provider tabs after streaming, without final submit', async () => {
  const f = await launch();
  try {
    const { page } = await start(f);
    try {
      await expect.poll(async () => (await read(f))?.phase, { timeout: 25000 }).toBe('done');
    } catch (error) {
      console.log('Session diagnostic:', JSON.stringify(await read(f)));
      for (const p of f.context.pages()) console.log('Page diagnostic:', p.url(), await p.locator('body').innerText().catch(() => 'unavailable'));
      throw error;
    }
    await expect(page.locator('[name=a1]')).toHaveValue('4');
    await expect(page.locator('[name=a2]')).toHaveValue('6');
    const s = await read(f);
    expect(s.dispatches).toBe(2);
    expect(s.stats).toEqual({ solved: 2, correct: 0, failed: 0 });
    expect(await page.evaluate(() => window.finalClicked)).toBeUndefined();
    // Tab AI dipakai ulang tanpa navigasi: dua soal, satu tab Gemini yang sama.
    expect(f.context.pages().filter(p => p.url().startsWith('https://gemini.google.com/'))).toHaveLength(1);
  } finally { await f.close(); }
});

// Dua soal di DUA halaman: tombol next Moodle adalah submit form sungguhan ke
// attempt.php?page=1. Reproduksi kasus "selesai satu soal tapi tidak lanjut ke
// halaman/soal berikutnya" setelah navigasi full-page.
test('navigates to the next quiz page after finishing a question and keeps going', async () => {
  test.setTimeout(90000);
  const page1 = '<!doctype html><html><body class="path-mod-quiz">' +
    '<form id="responseform" method="post" action="/mod/quiz/attempt.php?attempt=1&amp;page=1">' +
    '<div class="que shortanswer notyetanswered" id="q1"><div class="qtext">2+2</div>' +
    '<div class="answer"><input type="text" name="a1"></div></div>' +
    '<div class="submitbtns"><input type="submit" name="next" value="Next page"></div>' +
    '</form></body></html>';
  const page2 = '<!doctype html><html><body class="path-mod-quiz"><form id="responseform">' +
    '<div class="que shortanswer notyetanswered" id="q2"><div class="qtext">3+3</div>' +
    '<div class="answer"><input type="text" name="a2"></div></div>' +
    '<button name="finishattempt" type="button" onclick="window.finalClicked=true">Submit all and finish</button>' +
    '</form></body></html>';
  const f = await launch({
    resource: (host, url) => {
      if (host !== 'lms.test') return null;
      return url.includes('page=1') ? page2 : page1;
    },
  });
  try {
    const { page } = await start(f);
    try {
      await expect.poll(async () => (await read(f))?.phase, { timeout: 60000 }).toBe('done');
    } catch (error) {
      console.log('Session diagnostic:', JSON.stringify(await read(f)));
      for (const p of f.context.pages()) console.log('Page diagnostic:', p.url(), await p.locator('body').innerText().catch(() => 'unavailable'));
      throw error;
    }
    await expect.poll(() => page.url()).toContain('page=1');
    await expect(page.locator('[name=a2]')).toHaveValue('6');
    const s = await read(f);
    expect(s.dispatches).toBe(2);
    expect(s.stats).toEqual({ solved: 2, correct: 0, failed: 0 });
    expect(await page.evaluate(() => window.finalClicked)).toBeUndefined();
  } finally { await f.close(); }
});

// Varian interactive/adaptive seperti iLab: tombol Check ada DI DALAM .que dan
// me-reload halaman (server mengembalikan halaman sama dengan status Correct),
// baru tombol next berpindah halaman. Ini jalur: CHECK reload -> COMPLETE ->
// NAVIGATE next -> resume di halaman 2.
test('checks a question through a full reload, then moves on to the next page', async () => {
  test.setTimeout(90000);
  const quizPage = graded => '<!doctype html><html><body class="path-mod-quiz">' +
    '<form id="responseform" method="post" action="/mod/quiz/attempt.php?attempt=1&amp;page=1">' +
    `<div class="que shortanswer${graded ? ' correct' : ' notyetanswered'}" id="q1"><div class="qtext">2+2</div>` +
    '<div class="answer"><input type="text" name="a1"></div>' +
    (graded ? '<div class="info"><div class="state">Correct</div></div><div class="outcome">Jawaban benar</div>' : '') +
    '<button type="submit" name="check" formaction="/mod/quiz/attempt.php?attempt=1&amp;graded=1" value="Check">Check</button></div>' +
    '<div class="submitbtns"><input type="submit" name="next" value="Next page"></div>' +
    '</form></body></html>';
  const page2 = '<!doctype html><html><body class="path-mod-quiz"><form id="responseform">' +
    '<div class="que shortanswer notyetanswered" id="q2"><div class="qtext">3+3</div>' +
    '<div class="answer"><input type="text" name="a2"></div></div>' +
    '<button name="finishattempt" type="button" onclick="window.finalClicked=true">Submit all and finish</button>' +
    '</form></body></html>';
  const f = await launch({
    resource: (host, url) => {
      if (host !== 'lms.test') return null;
      if (url.includes('page=1')) return page2;
      return quizPage(url.includes('graded=1'));
    },
  });
  try {
    const { page } = await start(f);
    try {
      await expect.poll(async () => (await read(f))?.phase, { timeout: 60000 }).toBe('done');
    } catch (error) {
      console.log('Session diagnostic:', JSON.stringify(await read(f)));
      for (const p of f.context.pages()) console.log('Page diagnostic:', p.url(), await p.locator('body').innerText().catch(() => 'unavailable'));
      throw error;
    }
    await expect.poll(() => page.url()).toContain('page=1');
    await expect(page.locator('[name=a2]')).toHaveValue('6');
    const s = await read(f);
    expect(s.dispatches).toBe(2);
    // Q1 dinilai lewat Check (correct); Q2 di halaman 2 tanpa tombol Check → unknown.
    expect(s.stats).toEqual({ solved: 2, correct: 1, failed: 0 });
    expect(await page.evaluate(() => window.finalClicked)).toBeUndefined();
  } finally { await f.close(); }
});

test('cancel prevents a pending provider answer from filling a question', async () => {
  const f = await launch();
  try {
    const { page, popup } = await start(f);
    await expect.poll(async () => (await read(f))?.phase).toBe('waiting_for_answer');
    const s = await read(f);
    await popup.evaluate(id => chrome.runtime.sendMessage({ action: 'STOP_PROCESS', sessionId: id }), s.id);
    await expect.poll(async () => (await read(f))?.phase).toBe('aborted');
    await expect(page.locator('[name=a1]')).toHaveValue('');
  } finally { await f.close(); }
});

// Solid-color RGB PNG, so image fixtures need no binary files or dependencies.
function png(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, 200);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// Answers '4' only when an image file arrived through the chosen route; records
// what it received so the test can see the composite and the prompt.
const imageProvider = route => `<!doctype html><html><body>
${route === 'input' ? '<input type="file" accept="image/*" style="display:none" id="up">' : '<input type="file" accept=".pdf" style="display:none">'}
<div contenteditable="true" class="ql-editor"></div>
<button aria-label="Send message" onclick="send()">Send</button>
<script>
window.received = [];
const accept = files => { for (const file of files) {
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = () => window.received.push({ type: file.type, width: img.naturalWidth, height: img.naturalHeight });
  img.className = 'preview'; img.src = url; document.body.appendChild(img);
} };
document.querySelector('#up')?.addEventListener('change', e => accept(e.target.files));
if (${JSON.stringify(route)} === 'paste') document.querySelector('.ql-editor').addEventListener('paste', e => { if (e.clipboardData.files.length) { e.preventDefault(); accept(e.clipboardData.files); } });
function send() {
  window.prompt = document.querySelector('.ql-editor').textContent;
  document.querySelector('.ql-editor').textContent = '';
  const bubble = document.createElement('model-response'); document.body.appendChild(bubble);
  bubble.textContent = JSON.stringify({ jawaban: window.received.length ? '4' : 'tanpa-gambar', index_pilihan: window.received.length ? 2 : 1 });
}
</script></body></html>`;

async function solveImageQuiz(question, { route = 'input' } = {}) {
  const page = '<!doctype html><html><body class="path-mod-quiz"><form id="responseform">' + question + '</form></body></html>';
  const f = await launch({
    quiz: page, provider: imageProvider(route),
    resource: (_host, url) => url.endsWith('.png') ? { type: 'image/png', body: png(120, 80) } : null,
  });
  try {
    const { page: quizPage } = await start(f);
    await expect.poll(async () => (await read(f))?.phase, { timeout: 25000 }).toMatch(/done|error/);
    const providerPage = f.context.pages().find(p => p.url().startsWith('https://gemini.google.com/'));
    const seen = await providerPage?.evaluate(() => ({ received: window.received, prompt: window.prompt })).catch(() => null);
    return { session: await read(f), quizPage, seen, close: f.close };
  } catch (error) { await f.close(); throw error; }
}

test('sends a lazy-loaded question image that has not been displayed yet', async () => {
  const r = await solveImageQuiz('<div class="que shortanswer notyetanswered" id="q1"><div class="formulation">' +
    '<div class="qtext">Berapa titiknya? <div style="height:5000px"></div><img src="/pluginfile.php/1/question/questiontext/dots.png" alt="" loading="lazy"></div>' +
    '<div class="answer"><input type="text" name="a1"></div></div></div>');
  try {
    expect(r.session.error).toBeNull();
    await expect(r.quizPage.locator('[name=a1]')).toHaveValue('4');
    expect(r.seen.received).toEqual([{ type: 'image/png', width: 800, height: 110 }]);
    expect(r.seen.prompt).toContain('Gambar terlampir: Gambar soal.');
  } finally { await r.close(); }
});

test('reads a cross-origin question image through the background and falls back to paste', async () => {
  const r = await solveImageQuiz('<div class="que shortanswer notyetanswered" id="q1"><div class="formulation">' +
    '<div class="qtext">Berapa titiknya? <img src="https://cdn.test/soal/dots.png" alt=""></div>' +
    '<div class="answer"><input type="text" name="a1"></div></div></div>', { route: 'paste' });
  try {
    expect(r.session.error).toBeNull();
    await expect(r.quizPage.locator('[name=a1]')).toHaveValue('4');
    expect(r.seen.received).toHaveLength(1);
  } finally { await r.close(); }
});

test('labels image-only options with the same numbers the AI answers with', async () => {
  const option = n => `<div class="r${n % 2}"><input type="radio" name="q1:1_answer" value="${n}" id="a${n}">` +
    `<div class="d-flex" data-region="answer-label"><span class="answernumber">${'abc'[n]}. </span><img src="/pluginfile.php/1/question/answer/${n}.png" alt=""></div></div>`;
  const r = await solveImageQuiz('<div class="que multichoice notyetanswered" id="q1"><div class="formulation">' +
    '<div class="qtext">Mana gambar yang benar?</div><div class="answer">' + [0, 1, 2].map(option).join('') + '</div></div></div>');
  try {
    expect(r.session.error).toBeNull();
    expect(r.seen.prompt).toContain('1. [gambar Opsi 1]');
    expect(r.seen.prompt).toContain('Gambar terlampir: Opsi 1, Opsi 2, Opsi 3.');
    expect(r.seen.received).toEqual([{ type: 'image/png', width: 972, height: 232 }]);
    await expect(r.quizPage.locator('#a1')).toBeChecked();
  } finally { await r.close(); }
});
