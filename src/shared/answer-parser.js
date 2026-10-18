// Parser jawaban LLM dari balasan tab AI (injector) dan validasi di background.
// Fokus: ambil objek JSON terakhir yang benar-benar berisi `jawaban`, dengan brace
// matching seimbang agar jawaban koding berisi `{}` tidak memotong blok JSON.

// Cari index '}' yang menutup '{' di posisi `start`, dengan balanced depth dan
// sadar string JSON + escape. Kembalikan -1 bila tidak ada penutup seimbang.
export function matchClosingBrace(text, start) {
  if (typeof text !== 'string' || start < 0 || text[start] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function normalizeSmartQuotes(text) {
  return String(text)
    .replace(/[“”‟]/g, '"')
    .replace(/[‘’]/g, "'");
}


// Satu kali lintas: mengganti `\\n` lalu `\\\\` bertahap salah membaca `\\\\n`
// (backslash literal + n di kode) sebagai baris baru.
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
function decodeJsonishString(value) {
  return String(value).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (all, code) =>
    code.length === 5 ? String.fromCharCode(parseInt(code.slice(1), 16)) : ESCAPES[code] ?? all);
}

// Model sering menulis kode dengan baris baru/tab mentah di dalam string JSON.
// JSON.parse menolaknya; escape karakter kontrol yang ada di dalam string saja.
function escapeRawControlChars(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; out += ch; continue; }
    if (ch === '\\' && inString) { escaped = true; out += ch; continue; }
    if (ch === '"') inString = !inString;
    if (inString && ch === '\n') out += '\\n';
    else if (inString && ch === '\r') out += '\\r';
    else if (inString && ch === '\t') out += '\\t';
    else out += ch;
  }
  return out;
}

function tryParseLooseAnswerObject(candidate) {
  const src = normalizeSmartQuotes(candidate);
  if (!/"jawaban"\s*:/.test(src)) return null;
  const matchIdx = src.match(/"index_pilihan"\s*:\s*(\d+)/i);
  const index_pilihan = matchIdx ? parseInt(matchIdx[1], 10) : 0;
  const matchArr = src.match(/"jawaban"\s*:\s*\[([\s\S]*?)\]\s*(?:,\s*"index_pilihan"|\})/i);
  if (matchArr) {
    return {
      jawaban: [...matchArr[1].matchAll(/"([\s\S]*?)"/g)].map(m => decodeJsonishString(m[1])),
      index_pilihan,
    };
  }
  const matchStr = src.match(/"jawaban"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"index_pilihan"|\})/i);
  if (matchStr) return { jawaban: decodeJsonishString(matchStr[1]), index_pilihan };
  return null;
}

function tryParseStrictObject(candidate) {
  if (!candidate) return null;
  const variants = [String(candidate).trim()];
  const normalized = normalizeSmartQuotes(candidate).trim();
  if (normalized !== variants[0]) variants.push(normalized);
  for (const v of [...variants]) {
    const repaired = escapeRawControlChars(v);
    if (repaired !== v) variants.push(repaired);
  }

  for (const v of variants) {
    try {
      const obj = JSON.parse(v);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* coba varian berikutnya */ }
  }
  return null;
}

function tryParseAnswerCandidate(candidate) {
  return tryParseStrictObject(candidate) || tryParseLooseAnswerObject(candidate);
}

function hasAnswerKey(obj) {
  return Object.prototype.hasOwnProperty.call(obj || {}, 'jawaban');
}

function extractFencedObjects(text) {
  const out = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const m of String(text).matchAll(re)) {
    const obj = tryParseAnswerCandidate(m[1]);
    if (obj) out.push(obj);
  }
  return out;
}

function extractBalancedObjects(text) {
  const src = String(text || '');
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '{') continue;
    const end = matchClosingBrace(src, i);
    if (end === -1) continue;
    const obj = tryParseAnswerCandidate(src.slice(i, end + 1));
    if (obj) out.push(obj);
    i = end;
  }
  return out;
}

// Ambil objek JSON terakhir yang memuat key `jawaban`. Bila seluruh teks adalah JSON
// murni tanpa key tersebut, tetap kembalikan objeknya untuk kompatibilitas parser lama.
export function extractAnswerObject(text) {
  if (!text) return null;

  const direct = tryParseStrictObject(text);
  if (direct && hasAnswerKey(direct)) return direct;

  const objects = [
    ...extractFencedObjects(text),
    ...extractBalancedObjects(text),
  ];
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hasAnswerKey(objects[i])) return objects[i];
  }
  return direct || null;
}

function normalizeScalarAnswer(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isNullishAnswer(value) {
  return /^(null|undefined)$/i.test(String(value).trim());
}

// Normalisasi objek JSON model → bentuk { jawaban, index_pilihan } yang dipakai filler.
// Tolak jawaban kosong, nullish, object, dan array yang berisi elemen kosong/object.
export function normalizeAnswer(obj) {
  if (!obj || typeof obj !== 'object' || !hasAnswerKey(obj)) return null;

  let jawaban;
  if (Array.isArray(obj.jawaban)) {
    jawaban = obj.jawaban.map(normalizeScalarAnswer);
    if (jawaban.length === 0 || jawaban.some(v => !v.trim() || isNullishAnswer(v))) return null;
  } else {
    jawaban = normalizeScalarAnswer(obj.jawaban);
    if (!jawaban.trim() || isNullishAnswer(jawaban)) return null;
  }

  const rawIndex = obj.index_pilihan ?? 0;
  const parsedIndex = Number(rawIndex);
  const index_pilihan = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? Math.floor(parsedIndex) : 0;

  return { jawaban, index_pilihan };
}

export function parseAnswerFromText(text) {
  return normalizeAnswer(extractAnswerObject(text));
}
