import { describe, it, expect } from 'vitest';
import * as sessionModule from '../src/background/session-store.js';

async function setup() {
  expect(sessionModule.createSessionStore).toBeTypeOf('function');
  let saved = null;
  const disk = { read: async () => structuredClone(saved), write: async s => { saved = structuredClone(s); } };
  const store = sessionModule.createSessionStore(disk);
  const s = await store.start({ tabId: 7, url: 'https://lms.test/mod/quiz/attempt.php?attempt=1', provider: 'gemini' });
  return { store, disk, s };
}
const target = { key: 'q1', url: 'https://lms.test/mod/quiz/attempt.php?attempt=1', signature: 'empty' };

describe('persistent session owner', () => {
  it('keeps retry budgets and pending CHECK across worker recreation', async () => {
    const { store, disk, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    const waiting = await store.event(s.id, 'DISPATCH', { payload: { type: 'solve_text', text: '2+2' } });
    await store.answer(waiting, { jawaban: '4', index_pilihan: 0 });
    await store.event(s.id, 'APPLY');
    await store.event(s.id, 'CHECK', { beforeGrade: 'incorrect' });
    const resumed = await sessionModule.createSessionStore(disk).read();
    expect(resumed.phase).toBe('checking');
    expect(resumed.dispatches).toBe(1);
    expect(resumed.beforeGrade).toBe('incorrect');
  });
  it('accepts an answer once and rejects late or wrong-question answers', async () => {
    const { store, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    const waiting = await store.event(s.id, 'DISPATCH', { payload: {} });
    expect(await store.answer({ ...waiting, questionKey: 'other' }, { jawaban: '4' })).toBeNull();
    expect((await store.answer(waiting, { jawaban: '4' })).phase).toBe('answer_ready');
    expect(await store.answer(waiting, { jawaban: '5' })).toBeNull();
    expect((await store.read()).answer.jawaban).toBe('4');
  });
  it('serializes duplicate dispatches and makes terminal sessions immutable', async () => {
    const { store, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    const results = await Promise.allSettled([store.event(s.id, 'DISPATCH', { payload: {} }), store.event(s.id, 'DISPATCH', { payload: {} })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await store.event(s.id, 'ABORT');
    await expect(store.event(s.id, 'CHECK')).rejects.toThrow();
    expect((await store.read()).phase).toBe('aborted');
  });
  it('stops repeated provider failures at the persisted retry limit', async () => {
    const { store, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    for (let i = 0; i < 4; i++) {
      const waiting = await store.event(s.id, 'DISPATCH', { payload: {} });
      await store.failure(waiting, 'timeout');
    }
    expect((await store.read()).phase).toBe('error');
    expect((await store.read()).dispatches).toBe(4);
  });
  it('counts ungraded filled questions without claiming they are correct', async () => {
    const { store, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    const waiting = await store.event(s.id, 'DISPATCH', { payload: {} });
    await store.answer(waiting, { jawaban: '4' });
    await store.event(s.id, 'APPLY');
    const result = await store.event(s.id, 'COMPLETE', { outcome: 'unknown' });
    expect(result.stats).toEqual({ solved: 1, correct: 0, failed: 0 });
    expect(result.completed[target.url + '#' + target.key]).toBe('unknown');
  });
  it('rejects stale revisions before a DOM action can be acknowledged', async () => {
    const { store, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    await expect(store.event(s.id, 'DISPATCH', { payload: {}, expectedRevision: s.revision })).rejects.toThrow(/changed/);
  });
  it('stores the dispatched input snapshot and clears a finished request payload', async () => {
    const { store, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    const waiting = await store.event(s.id, 'DISPATCH', { signature: 'edited', payload: { text: '2+2' } });
    expect(waiting.target.signature).toBe('edited');
    await store.answer(waiting, { jawaban: '4' });
    await store.event(s.id, 'APPLY');
    const done = await store.event(s.id, 'FAIL', { error: 'Interrupted' });
    expect(done.payload).toBeNull();
    expect(done.answer).toBeNull();
  });
  it('claims a provider request only once even after the worker is recreated', async () => {
    const { store, disk, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    const waiting = await store.event(s.id, 'DISPATCH', { payload: {} });
    expect(await store.claim(waiting)).not.toBeNull();
    expect(await sessionModule.createSessionStore(disk).claim(waiting)).toBeNull();
  });
  it('does not overwrite a running session on a concurrent start', async () => {
    const { store, s } = await setup();
    await expect(store.start({ tabId: 8 })).rejects.toThrow();
    expect((await store.read()).id).toBe(s.id);
  });
});

describe('rejected answers', () => {
  it('remembers answers Moodle graded wrong until the question changes', async () => {
    const { store, s } = await setup();
    await store.event(s.id, 'QUESTION', { target });
    const waiting = await store.event(s.id, 'DISPATCH', { payload: {} });
    await store.answer(waiting, { jawaban: '5', index_pilihan: 0 });
    await store.event(s.id, 'APPLY');
    await store.event(s.id, 'CHECK', { beforeGrade: '' });
    const retry = await store.event(s.id, 'RETRY', { error: 'Incorrect' });
    expect(retry.rejected).toEqual([{ answer: { jawaban: '5', index_pilihan: 0 }, feedback: 'Incorrect' }]);
    await store.event(s.id, 'DISPATCH', { payload: {} });
    await store.event(s.id, 'FAIL', { error: 'x' });
    const next = await store.start({ tabId: 7, url: target.url });
    await store.event(next.id, 'QUESTION', { target: { ...target, key: 'q2' } });
    expect((await store.read()).rejected).toEqual([]);
  });
});
