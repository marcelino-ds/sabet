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
    const data = await createMoodleAdapter().payload(q, { provider: 'gemini', prompt: 'Use Indonesian', error: 'Previous answer failed' });
    expect(data.text).toContain('1. Merah');
    expect(data.text).toContain('2. Biru');
    expect(data.prompt).toContain('Previous answer failed');
    expect(data.prompt).toContain('Use Indonesian');
  });
  it('skips a completed matching question before its deferred grade exists', () => {
    const q = question('<select><option>One</option></select>', 'match');
    const completed = { [location.href + '#' + getQuestionKey(q, 0)]: 'unknown' };
    expect(createMoodleAdapter().next({ completed })).toBeNull();
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
