// Deteksi, pembacaan & komposit canvas gambar soal untuk dikirim ke AI.
import { getMoodleOptions, getMatchRows } from './moodle-options.js';

const ICON_NAME = /icon|sprite|spacer|blank|bullet|1x1|pixel/;
const OUTSIDE_QUESTION = '.icon, .questionflag, .info, .outcome, .feedback, .specificfeedback, .generalfeedback, .rightanswer, .accesshide, .sr-only';

// Ikon tema/feedback Moodle, bukan isi soal. Nama file saja yang dicek (bukan seluruh
// URL) agar domain atau folder kampus yang kebetulan mengandung "pixel" tidak ikut.
export function isDecorativeImage(img) {
  const raw = img.getAttribute('src') || '';
  if (/^data:image\/svg/i.test(raw)) return true;
  let url;
  try { url = new URL(img.src || raw, location.href); } catch { return true; }
  if (/\/theme\/image\.php\/|\/pix\//.test(url.pathname)) return true;
  const name = url.protocol === 'data:' ? '' : url.pathname.split('/').pop().toLowerCase();
  return ICON_NAME.test(name) || img.classList.contains('icon') || !!img.closest(OUTSIDE_QUESTION);
}

// Minimal sekitar 50x50 (ikon <= 48px tersaring), tapi gambar rumus yang lebar dan
// pendek tetap lolos.
export function isMeaningfulSize(width, height) {
  return Math.min(width, height) >= 16 && width * height >= 2500;
}

const isLoaded = img => img.complete && img.naturalWidth > 0;

// Gambar lazy-load yang belum terlihat belum punya ukuran, jadi ukurannya baru
// dinilai setelah dibaca ulang. Ukuran 0 di DOM bukan berarti gambarnya ikon.
export function findQuestionImages(que) {
  if (!que) return [];
  const area = que.querySelector('.formulation') || que;
  const qtext = que.querySelector('.qtext');
  const answer = que.querySelector('.answer');
  const options = getMoodleOptions(que);
  const matchRows = getMatchRows(que);
  const rowOf = input => input.closest('.r0, .r1') || [...(answer?.children || [])].find(child => child.contains(input));
  const labelOf = img => {
    if (qtext?.contains(img)) return 'Gambar soal';
    const option = options.find(({ input }) => rowOf(input)?.contains(img));
    if (option) return `Opsi ${option.index + 1}`;
    const match = matchRows.find(({ row }) => row?.contains(img));
    return match ? `Baris ${match.index + 1}` : 'Gambar jawaban';
  };
  const seen = new Set();
  const found = [];
  for (const img of area.querySelectorAll('img[src]')) {
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src) || isDecorativeImage(img)) continue;
    if (isLoaded(img) && !isMeaningfulSize(img.naturalWidth, img.naturalHeight)) continue;
    seen.add(src);
    const label = labelOf(img);
    found.push({ img, src, label });
  }
  const totals = {};
  for (const item of found) totals[item.label] = (totals[item.label] || 0) + 1;
  const counts = {};
  return found.map(item => totals[item.label] > 1
    ? { ...item, label: `${item.label} (${counts[item.label] = (counts[item.label] || 0) + 1})` }
    : item);
}

function sameOrigin(src) {
  try {
    const url = new URL(src, location.href);
    return url.origin === location.origin || url.protocol === 'data:' || url.protocol === 'blob:';
  } catch { return false; }
}

function loadImage(src, signal, ms = 15000) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const img = new Image();
    const finish = error => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      img.onload = img.onerror = null;
      error ? reject(error) : resolve(img);
    };
    const abort = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Gambar soal terlalu lama dimuat.')), ms);
    signal?.addEventListener('abort', abort, { once: true });
    img.onload = () => finish();
    img.onerror = () => finish(new Error('Gambar soal gagal dimuat.'));
    img.src = src;
  });
}

// Gambar yang sukses dimuat tetap bisa membuat canvas "tainted" (mis. pluginfile
// yang redirect ke S3/CDN). Uji dulu di canvas 1x1 sebelum dipakai.
function readable(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch { return false; }
}

// Image baru (bukan elemen halaman) selalu dimuat eager, jadi gambar lazy-load ikut
// terbaca. Gambar lintas origin diambil lewat background yang punya host permission.
async function readImage(src, fetchImage, signal) {
  if (sameOrigin(src)) {
    const img = await loadImage(src, signal).catch(error => { if (signal?.aborted) throw error; return null; });
    if (img && readable(img)) return img;
  }
  return loadImage(await fetchImage(src), signal);
}

// Dimuat paralel (opsi bergambar bisa 4-5 file), urutan hasil tetap urutan DOM.
export async function collectQuestionImages(que, { fetchImage, signal } = {}) {
  const loaded = await Promise.all(findQuestionImages(que).map(async ({ img: element, src, label }) => {
    let img;
    try { img = await readImage(src, fetchImage, signal); } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`Gambar soal tidak dapat dibaca: ${error.message}`, { cause: error });
    }
    const width = img.naturalWidth || element.width || 300;
    const height = img.naturalHeight || element.height || 150;
    return isMeaningfulSize(width, height) ? { img, width, height, label } : null;
  }));
  return loaded.filter(Boolean);
}

const MAX_PNG_LENGTH = 3_500_000;

// Satukan gambar jadi 1 komposit canvas. 1 kolom jika <=2 gambar, 2 kolom jika lebih.
// Tiap gambar diberi label asalnya ("Gambar soal", "Opsi 2") sesuai teks prompt.
export async function stitchImages(images) {
  const COLS = images.length <= 2 ? 1 : 2;
  const COL_W = COLS === 1 ? 800 : 480;
  const PAD = 12;
  const LABEL_H = 30;
  const BG = '#ffffff';
  const ACCENT = '#2563eb';

  const items = images.map(({ img, width, height, label }) => {
    const scale = Math.min(1, COL_W / width);
    return { img, sw: Math.round(width * scale), sh: Math.round(height * scale), label };
  }).filter(it => it.sw > 0 && it.sh > 0);
  if (items.length === 0) return null;

  const rows = Math.ceil(items.length / COLS);
  const rowHeights = [];
  for (let r = 0; r < rows; r++) {
    rowHeights.push(Math.max(...items.slice(r * COLS, r * COLS + COLS).map(it => it.sh + LABEL_H)));
  }
  const totalW = COLS * COL_W + (COLS - 1) * PAD;
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * PAD;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, totalW, totalH);

  try {
    let y = 0;
    for (let r = 0; r < rows; r++) {
      let x = 0;
      for (const { img, sw, sh, label } of items.slice(r * COLS, r * COLS + COLS)) {
        ctx.fillStyle = ACCENT;
        ctx.fillRect(x, y, COL_W, LABEL_H);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 10, y + 20);
        ctx.drawImage(img, x, y + LABEL_H, sw, sh);
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, COL_W, sh + LABEL_H);
        x += COL_W + PAD;
      }
      y += rowHeights[r] + PAD;
    }
    // Sesi (termasuk gambar) disimpan di chrome.storage.local yang berkuota 10 MB.
    const png = canvas.toDataURL('image/png');
    return png.length <= MAX_PNG_LENGTH ? png : canvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('[SABET] stitchImages: canvas tidak bisa dibaca.', e);
    return null;
  }
}
