import { describe, it, expect } from 'vitest';
import * as flow from '../src/content/flow.js';
import { createSessionStore } from '../src/background/session-store.js';

async function fixture() {
  let saved;
  const store = createSessionStore({ read: async () => saved, write: async value => { saved = structuredClone(value); } });
  const session = await store.start({ tabId: 7, url: 'https://lms.test/mod/quiz/attempt.php?attempt=1' });
  const target = { key: 'q1', url: session.url, signature: 'empty', type: 'shortanswer', text: '2+2' };
  const effects = [];
  const controller = new AbortController();
  const adapter = {
    prepare: async () => {},
    next: s => s.stats.solved ? null : target,
    assertTarget: () => {},
    payload: async () => ({ type: 'solve_text', text: '2+2' }),
    apply: async () => { effects.push('fill'); },
    precheckButton: () => null,
    checkButton: () => null,
    grade: () => null,
    gradeSignature: () => '',
    click: () => { effects.push('click'); },
    feedback: () => 'Wrong answer',
    navigate: async () => false,
  };
  const deps = {
    session, adapter, signal: controller.signal, status: () => {}, pause: async () => {},
    read: () => store.read(),
    event: (s, type, data) => store.event(s.id, type, data),
    launch: async s => { effects.push('solve'); await store.answer(s, { jawaban: '4', index_pilihan: 0 }); },
  };
  return { deps, store, target, effects, controller };
}

describe('session flow', () => {
  it('finishes a deferred-feedback question without claiming a correct grade', async () => {
    expect(flow.runFlow).toBeTypeOf('function');
    const f = await fixture();
    await flow.runFlow(f.deps);
    expect(f.effects).toEqual(['solve', 'fill']);
    expect((await f.store.read()).stats).toEqual({ solved: 1, correct: 0, failed: 0 });
    expect((await f.store.read()).phase).toBe('done');
  });
  it('does not CHECK after cancellation during a fill', async () => {
    expect(flow.runFlow).toBeTypeOf('function');
    const f = await fixture();
    f.deps.adapter.apply = async () => { f.controller.abort(); };
    f.deps.adapter.checkButton = () => ({});
    await flow.runFlow(f.deps);
    expect(f.effects).toEqual(['solve']);
  });
  it('reads the persisted grade after reload without solving or clicking CHECK again', async () => {
    expect(flow.runFlow).toBeTypeOf('function');
    const f = await fixture();
    await f.store.event(f.deps.session.id, 'QUESTION', { target: f.target });
    const waiting = await f.store.event(f.deps.session.id, 'DISPATCH', { payload: {} });
    await f.store.answer(waiting, { jawaban: '4' });
    await f.store.event(waiting.id, 'APPLY');
    await f.store.event(waiting.id, 'CHECK', { beforeGrade: '' });
    f.deps.adapter.grade = () => true;
    f.deps.adapter.gradeSignature = () => 'correct';
    f.deps.adapter.checkButton = () => ({});
    await flow.runFlow(f.deps);
    expect(f.effects).toEqual([]);
    expect((await f.store.read()).dispatches).toBe(1);
  });
  it('fails without filling when a user changes the locked question', async () => {
    expect(flow.runFlow).toBeTypeOf('function');
    const f = await fixture();
    f.deps.adapter.assertTarget = () => { throw new Error('Question changed'); };
    await flow.runFlow(f.deps);
    expect(f.effects).not.toContain('fill');
    expect((await f.store.read()).phase).toBe('error');
  });
});
