import { afterEach, describe, expect, it } from 'vitest';
import { createMoodleAdapter } from '../src/content/moodle-adapter.js';
import { getQuestionKey } from '../src/content/question-target.js';
afterEach(() => { document.body.innerHTML = ''; });
function question(html, type = 'shortanswer') {
  document.body.innerHTML = `<div class="que ${type} notyetanswered" id="q1"><div class="qtext">Test question</div><div class="answer">${html}</div></div>`;
  return document.querySelector('.que');
}
describe('Moodle adapter', () => {
  it('sends numbered choices from the actual inputs', async () => {
    const q = question('<label><input type="radio" name="q" value="0">Merah</label><label><input type="radio" name="q" value="1">Biru</label>', 'multichoice');
    const data = await createMoodleAdapter().payload(q, { provider: 'gemini', prompt: 'Use Indonesian', error: 'Elemen AI belum siap.' });
    expect(data.text).toContain('1. Merah');
    expect(data.text).toContain('2. Biru');
    expect(data.text).toContain('PILIH SATU.');
    // Teks soal dari .qtext: opsi hanya muncul sekali, di daftar bernomor.
    expect(data.text.match(/Merah/g)).toHaveLength(1);
    expect(data.prompt).toContain('Use Indonesian');
    expect(data.prompt).not.toContain('Elemen AI');
  });
  it('tells the AI which answers Moodle already graded wrong', async () => {
    const q = question('<label><input type="radio" name="q" value="0">Merah</label><label><input type="radio" name="q" value="1">Biru</label>', 'multichoice');
    const rejected = [{ answer: { jawaban: 'Merah', index_pilihan: 1 }, feedback: 'Your answer is incorrect.' }];
    const data = await createMoodleAdapter().payload(q, { rejected });
    expect(data.prompt).toContain('dinilai SALAH');
    expect(data.prompt).toContain('"jawaban":"Merah"');
    expect(data.prompt).toContain('Feedback Moodle: Your answer is incorrect.');
  });
  it('marks checkbox questions as multi-select', async () => {
    const q = question('<label><input type="checkbox" value="0">Merah</label><label><input type="checkbox" value="1">Biru</label>', 'multichoice');
    expect((await createMoodleAdapter().payload(q, {})).text).toContain('PILIH SATU ATAU LEBIH');
  });
  it('skips a completed matching question before its deferred grade exists', () => {
    const q = question('<select><option>One</option></select>', 'match');
    const completed = { [location.href + '#' + getQuestionKey(q, 0)]: 'unknown' };
    expect(createMoodleAdapter().next({ completed })).toBeNull();
  });
  it('resolves the target by container id when post-grade noise shifts the text hash', () => {
    const q = question('<input type="text" value="4">');
    const adapter = createMoodleAdapter();
    const saved = adapter.snapshot(q);
    // Perubahan teks apa pun yang lolos dari strip-list tidak boleh membuat
    // resume kehilangan target: id kontainer tetap menunjuk slot yang sama.
    q.querySelector('.qtext').textContent = 'Test question (dinilai)';
    expect(adapter.resolve(saved)).toBe(q);
  });
  it('resolves null when the saved target belongs to a different page', () => {
    const q = question('<input type="text">');
    const saved = { ...createMoodleAdapter().snapshot(q), url: 'https://lms.test/mod/quiz/attempt.php?attempt=1&page=9' };
    expect(createMoodleAdapter().resolve(saved)).toBeNull();
  });
  it('refuses partial short answers before changing any input', async () => {
    const q = question('<input type="text"><input type="text">');
    await expect(createMoodleAdapter().apply(q, { jawaban: ['4'] })).rejects.toThrow();
    expect([...q.querySelectorAll('input')].map(n => n.value)).toEqual(['', '']);
  });
  it('fails CodeRunner when the only editor is unavailable', async () => {
    const q = question('<div class="ace_editor"></div>', 'coderunner');
    await expect(createMoodleAdapter().apply(q, { jawaban: 'print(4)' })).rejects.toThrow();
  });
  it('never navigates by a generic submit button', async () => {
    question('<input type="text" value="4">');
    const button = document.createElement('button');
    button.type = 'submit'; button.textContent = 'Submit all and finish';
    let clicks = 0; button.onclick = () => clicks++;
    document.body.appendChild(button);
    expect(await createMoodleAdapter().navigate()).toBe(false);
    expect(clicks).toBe(0);
  });
  it('rejects a scalar answer for two blanks before writing either one', async () => {
    const q = question('<input type="text"><input type="text">');
    await expect(createMoodleAdapter().apply(q, { jawaban: '4' })).rejects.toThrow();
    expect(q.querySelector('input').value).toBe('');
  });
  it('rejects incomplete matching answers before changing any select', async () => {
    const q = question('<select><option value="">Choose</option><option value="1">One</option></select><select><option value="">Choose</option><option value="1">One</option></select>', 'match');
    await expect(createMoodleAdapter().apply(q, { jawaban: ['One'] })).rejects.toThrow();
    expect(q.querySelector('select').value).toBe('');
  });
  it('includes gap context and the original code template in solver input', async () => {
    const q = question('for (<input type="text"> : <input type="text">) {}', 'coderunner');
    const payload = await createMoodleAdapter().payload(q, {});
    expect(payload.text).toContain('for (');
    expect(payload.text).toContain('[GAP1]');
    expect(payload.text).toContain('[GAP2]');
  });
});
