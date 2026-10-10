import { describe, it, expect, afterEach } from 'vitest';
import { findQuestionByKey, getQuestionKey, getQuestionInputSignature } from '../src/content/question-target.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('question-target', () => {
  it('uses the stable Moodle question id when present', () => {
    const q = document.createElement('div');
    q.id = 'q123';
    expect(getQuestionKey(q, 0)).toMatch(/^id:q123:text:/);
  });

  it('creates the same fallback key for the same question position and text', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    a.innerHTML = '<div class="qtext">Berapa 2 + 2?</div>';
    b.innerHTML = '<div class="qtext">Berapa 2 + 2?</div>';
    expect(getQuestionKey(a, 1)).toBe(getQuestionKey(b, 1));
    expect(getQuestionKey(a, 1)).not.toBe(getQuestionKey(a, 2));
  });

  it('finds the locked question instead of the next empty question', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.id = 'q1';
    second.id = 'q2';
    expect(findQuestionByKey([first, second], getQuestionKey(first, 0))).toBe(first);
  });

  it('changes the input signature when a user edits an answer while AI is working', () => {
    const q = document.createElement('div');
    q.id = 'q1';
    q.innerHTML = '<div class="answer"><input type="text" value=""></div>';
    const before = getQuestionInputSignature(q);
    q.querySelector('input').value = 'manual answer';
    expect(getQuestionInputSignature(q)).not.toBe(before);
  });
  it('changes the key when options change under the same question id', () => {
    const q = document.createElement('div');
    q.id = 'q1';
    q.innerHTML = '<div class="qtext">Choose</div><label><input type="radio">Red</label>';
    const before = getQuestionKey(q, 0);
    q.querySelector('label').lastChild.textContent = 'Blue';
    expect(getQuestionKey(q, 0)).not.toBe(before);
  });
  it('keeps the same target when Moodle adds grading feedback and sequence inputs', () => {
    const q = document.createElement('div'); q.id = 'q1';
    q.innerHTML = '<div class="qtext">Choose</div><label><input type="radio">Red<span class="accesshide"></span></label><input type="hidden" value="1">';
    const key = getQuestionKey(q, 0); const inputs = getQuestionInputSignature(q);
    q.querySelector('.accesshide').textContent = 'Correct';
    q.querySelector('[type=hidden]').value = '2';
    expect(getQuestionKey(q, 0)).toBe(key);
    expect(getQuestionInputSignature(q)).toBe(inputs);
  });
});
