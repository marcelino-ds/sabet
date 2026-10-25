import { htmlToMarkdown } from './html-to-markdown.js';
import { detectPlatform, detectQuestionType } from './platform.js';
import { getExistingCode } from './ace-editor.js';
import { rpc, delay } from '../shared/browser.js';
import { sameQuizPage } from '../shared/util.js';
import {
  findUnansweredQuestion, findButton, getGapFillInputs, buildGapFillTemplate,
} from './dom-utils.js';
import { collectQuestionImages, stitchImages } from './question-images.js';
import { getMoodleOptions, getMatchRows } from './moodle-options.js';
import {
  moodleFillMultichoice, moodleFillShortAnswer, moodleFillEssay,
  moodleFillCodeRunner, moodleFillMatch,
} from './moodle-fill.js';
import { checkIfCorrect, officialGradeSignature, CODERUNNER_RESULT_SELECTORS } from './grading.js';
import { getQuestionKey, getQuestionInputSignature, findQuestionByKey } from './question-target.js';

// .qtext saja: .formulation ikut memuat opsi (dikirim terpisah & bernomor), baris
// editor Ace, dan teks aksesibilitas Moodle.
function textOf(que) {
  const body = que?.querySelector('.qtext') || que?.querySelector('.formulation');
  return body ? htmlToMarkdown(body) : '';
}

function buildQuestionText(que) {
  const type = detectQuestionType(que);
  let text = `SOAL (${type}):\n${textOf(que)}`;
  if (type === 'multichoice' || type === 'truefalse') {
    // Jangan buang opsi kosong: nomor di prompt harus tetap sama dengan index_pilihan.
    const options = getMoodleOptions(que);
    if (options.length) {
      const multi = options.some(option => option.input.type === 'checkbox');
      text += multi
        ? '\n\nJenis: PILIH SATU ATAU LEBIH. "jawaban" WAJIB array teks semua opsi yang benar.'
        : '\n\nJenis: PILIH SATU.';
      text += `\n\nOpsi (urutan = index_pilihan):\n${options.map((option, i) => `${i + 1}. ${option.text || '(kosong)'}`).join('\n')}`;
    }
  }
  if (type === 'match') {
    const rows = getMatchRows(que);
    if (rows.length) {
      text += `\n\nBaris:\n${rows.map((row, i) => `${i + 1}. ${row.stem}`).join('\n')}`;
      text += `\n\nPilihan:\n${[...new Set(rows.flatMap(row => row.options))].map(option => `- ${option}`).join('\n')}`;
    }
  }
  if (type === 'coderunner') {
    const gaps = getGapFillInputs(que);
    if (gaps.length) text += `\n\nGAPFILL: isi tepat ${gaps.length} kotak sebagai array. Jangan ulangi template.\n${buildGapFillTemplate(que, gaps)}`;
    else text += '\n\nKODE TEMPLATE (kembalikan seluruh kode):\n' + getExistingCode(que);
  }
  if (type === 'shortanswer' || type === 'numerical') text += '\nKotak isian: ' + que.querySelectorAll('input[type="text"]').length;
  return text.trim();
}
// Hanya jawaban yang sudah dinilai SALAH oleh Moodle. Error teknis (tab AI, upload)
// tidak berguna bagi AI dan bisa membuatnya ragu pada jawaban yang benar.
function rejectedNote(rejected) {
  if (!rejected?.length) return '';
  const lines = rejected.map(({ answer, feedback }, i) => {
    const note = feedback ? `\n   Feedback Moodle: ${feedback.replace(/\s+/g, ' ').trim()}` : '';
    return `${i + 1}. ${JSON.stringify(answer).slice(0, 2000)}${note}`;
  });
  return `PERHATIAN: jawaban berikut sudah dikirim dan dinilai SALAH oleh Moodle. Jangan ulangi; periksa ulang soalnya.\n${lines.join('\n')}`;
}
function snapshot(que) {
  return {
    key: getQuestionKey(que, [...document.querySelectorAll('.que')].indexOf(que)),
    url: location.href,
    signature: getQuestionInputSignature(que),
    type: detectQuestionType(que),
    id: que.id,
  };
}
async function fill(que, data, report, signal, sessionId) {
  signal?.throwIfAborted();
  const type = detectQuestionType(que);
  if (Array.isArray(data.jawaban) && type === 'essay') throw new Error('Essay harus menerima teks, bukan array.');
  const raw = Array.isArray(data.jawaban) ? data.jawaban : type === 'coderunner' ? String(data.jawaban ?? '') : String(data.jawaban ?? '').trim();
  if (!raw || (Array.isArray(raw) && !raw.length)) throw new Error('Jawaban AI kosong.');
  const upper = Array.isArray(raw) ? raw.map(value => String(value).toUpperCase()) : String(raw).toUpperCase();
  let ok = false;
  if (type === 'multichoice' || type === 'truefalse') ok = moodleFillMultichoice(que, raw, upper, Number(data.index_pilihan || 0), report);
  else if (type === 'shortanswer' || type === 'numerical') {
    const inputs = [...que.querySelectorAll('input[type="text"]')];
    if ((Array.isArray(raw) ? raw.length : 1) !== inputs.length) throw new Error('Jumlah jawaban tidak sama dengan kotak isian.');
    ok = moodleFillShortAnswer(que, raw, report);
  }
  else if (type === 'essay') {
    if (que.querySelector('iframe')) {
      const result = await rpc({ action: 'EDITOR_ACCESS', sessionId, kind: 'essay', id: que.id, value: raw });
      ok = result.ok;
    } else ok = moodleFillEssay(que, raw, report);
  } else if (type === 'match') {
    const rows = getMatchRows(que);
    const answers = Array.isArray(raw) ? raw : [raw];
    const norm = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
    if (answers.length !== rows.length || rows.some((r, i) => r.options.filter(o => norm(o) === norm(answers[i])).length !== 1)) throw new Error('Jawaban menjodohkan belum lengkap atau ambigu.');
    ok = moodleFillMatch(que, raw, report);
  } else if (type === 'coderunner') {
    const gaps = getGapFillInputs(que);
    if (gaps.length && (Array.isArray(raw) ? raw.length : 1) !== gaps.length) throw new Error('Jumlah jawaban gapfill tidak sesuai.');
    if (!gaps.length && que.querySelector('.ace_editor')) {
      if (!sessionId || !que.id) throw new Error('Editor CodeRunner belum tersedia.');
      const result = await rpc({ action: 'EDITOR_ACCESS', sessionId, id: que.id, kind: 'ace', value: raw });
      ok = result.ok && String(result.value).replace(/\r\n?/g, '\n') === String(raw).replace(/\r\n?/g, '\n');
    } else ok = await moodleFillCodeRunner(que, raw, report);
  }
  signal?.throwIfAborted();
  if (!ok) throw new Error('Jawaban tidak dapat diterapkan ke elemen Moodle.');
}
export function createMoodleAdapter(sessionId) {
  return {
    get url() { return location.href; },
    prepare: async signal => {
      if (detectPlatform() !== 'moodle' || /\/(summary|review)\.php$/.test(location.pathname)) throw new Error('Buka halaman pengerjaan kuis Moodle.');
      // Server kampus bisa lambat: beri 15 detik sampai .que dirender.
      for (let i = 0; !document.querySelector('.que') && i < 75; i++) await delay(200, signal);
      if (!document.querySelector('.que')) throw new Error('Soal belum tersedia di halaman ini.');
    },
    next: state => {
      const questions = [...document.querySelectorAll('.que')];
      if (state.phase === 'solving' && state.target) return findQuestionByKey(questions, state.target.key);
      return questions.find((question, index) => {
        const key = getQuestionKey(question, index);
        return !state.completed?.[`${location.href}#${key}`] && findUnansweredQuestion([question]) === question;
      }) || null;
    },
    snapshot,
    // Resume setelah submit/reload: URL boleh berbeda param tambahan (graded,
    // scrollpos, dsb.) selama masih attempt+page yang sama.
    resolve: saved => {
      if (!sameQuizPage(saved?.url, location.href)) return null;
      const questions = [...document.querySelectorAll('.que')];
      const exact = findQuestionByKey(questions, saved.key);
      if (exact || !saved?.id) return exact;
      // Feedback penilaian bisa menggeser hash teks soal; id kontainer Moodle
      // (question-N) stabil per slot, jadi fallback ke id bila unik di halaman.
      const byId = questions.filter(que => que.id === saved.id);
      return byId.length === 1 ? byId[0] : null;
    },
    persistApplied: true,
    signature: que => getQuestionInputSignature(que),
    assertTarget: (que, strict, saved) => {
      if (!que) throw new Error('Target soal tidak ditemukan.');
      if (strict && saved?.signature && getQuestionInputSignature(que) !== saved.signature) throw new Error('Soal berubah saat AI bekerja.');
    },
    payload: async (que, state, signal) => {
      signal?.throwIfAborted();
      let dataUrl = null;
      const images = await collectQuestionImages(que, {
        signal,
        fetchImage: url => rpc({ action: 'FETCH_IMAGE', sessionId, url }, 30000),
      });
      if (images.length) {
        dataUrl = await stitchImages(images);
        if (!dataUrl) throw new Error('Gambar soal tidak dapat dibaca. Review soal bergambar secara manual.');
      }
      let text = buildQuestionText(que);
      if (dataUrl) text += `\n\nGambar terlampir: ${images.map(image => image.label).join(', ')}. Label di atas tiap gambar menunjukkan asalnya; "Opsi N" adalah gambar milik opsi nomor N.`;
      if (detectQuestionType(que) === 'coderunner' && que.querySelector('.ace_editor') && sessionId) {
        const code = await rpc({ action: 'EDITOR_ACCESS', sessionId, id: que.id, kind: 'ace' });
        if (code.ok) text += '\nKode editor saat ini:\n' + code.value;
      }
      signal?.throwIfAborted();
      return {
        ai: state.provider || 'gemini',
        type: dataUrl ? 'solve_image' : 'solve_text',
        text, dataUrl, prompt: [state.prompt, rejectedNote(state.rejected)].filter(Boolean).join('\n\n'),
        target: snapshot(que),
      };
    },
    apply: async (que, data, signal) => fill(que, data, () => {}, signal, sessionId),
    precheckButton: que => findButton(que, ['precheck']),
    checkButton: que => findButton(que, ['check', 'periksa', 'submit'], ['precheck', 'pre-check']),
    grade: checkIfCorrect,
    gradeSignature: officialGradeSignature,
    resultSignature: que => [...que.querySelectorAll(CODERUNNER_RESULT_SELECTORS)].map(el => (el.innerText || el.textContent || '').trim()).join('|'),
    feedback: que => que.querySelector('.outcome, .feedback, .coderunner-test-results, .CodeRunner-test-results')?.innerText || '',
    click: element => {
      if (!element?.isConnected || element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('Tombol Moodle belum siap.');
      element.click();
    },
    navigate: async signal => {
      const beforeUrl = location.href;
      const before = textOf(document.querySelector('.que'));
      const next = document.querySelector('input[name="next"], button[name="next"], .mod_quiz-next-nav');
      if (!next) return false;
      if (/finishattempt|submit all|kirim semua|finish|selesai/i.test([next.name, next.value, next.textContent].join(' '))) return false;
      signal?.throwIfAborted();
      next.click();
      for (let i = 0; i < 32; i++) {
        if (signal?.aborted) return false;
        await delay(250, signal);
        if (location.href !== beforeUrl || textOf(document.querySelector('.que')) !== before) return true;
      }
      throw new Error('Navigasi tidak selesai. Buka halaman berikutnya secara manual.');
    },
  };
}
