import { afterEach, describe, expect, it, vi } from 'vitest';
import { backgroundFixture } from './helpers/background-fixture.js';
import { runFlow } from '../src/content/flow.js';
import { createMoodleAdapter } from '../src/content/moodle-adapter.js';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function markup() {
  document.body.innerHTML = '<div class="que shortanswer notyetanswered" id="q1"><div class="qtext">2+2</div><div class="answer"><input type="text"></div></div><div class="que shortanswer notyetanswered" id="q2"><div class="qtext">3+3</div><div class="answer"><input type="text"></div></div>';
}
describe('background and Moodle flow integration', () => {
  it('does not start an API side effect after cancellation during settings lookup', async () => {
    const f = backgroundFixture();
    const s = await f.service.store.start({ tabId: 7, url: f.content.url, transport: 'api' });
    await f.service.store.event(s.id, 'QUESTION', { target: { key: 'q1', url: s.url } });
    const waiting = await f.service.store.event(s.id, 'DISPATCH', { payload: { text: 'q' } });
    const originalGet = f.api.storage.local.get;
    let release; let lookup = false;
    f.api.storage.local.get = async key => key === 'apiKey_gemini'
      ? new Promise(resolve => { lookup = true; release = () => resolve({ apiKey_gemini: 'fake' }); })
      : originalGet(key);
    let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return { ok: true, json: async () => ({}) }; });
    await f.service.handle({ action: 'OPEN_AI', sessionId: s.id, requestId: waiting.requestId, questionKey: 'q1' }, f.content);
    await vi.waitFor(() => expect(lookup).toBe(true));
    await f.service.handle({ action: 'STOP_PROCESS', sessionId: s.id }, f.content);
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toBe(0);
    expect((await f.service.store.read()).phase).toBe('aborted');
  });
  it('fills two deferred questions via API and stores unknown grades exactly once', async () => {
    markup();
    const f = backgroundFixture(location.href);
    f.data.apiKey_gemini = 'test-key';
    let calls = 0;
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ jawaban: String(++calls * 2 + 2), index_pilihan: 0 }) }] } }] }) }));
    const s = await f.service.store.start({ tabId: 7, url: location.href, provider: 'gemini', transport: 'api' });
    const read = () => f.service.handle({ action: 'SESSION_STATE' }, f.content);
    await runFlow({ session: s, adapter: createMoodleAdapter(), read,
      event: (s, event, data) => f.service.handle({ action: 'SESSION_EVENT', sessionId: s.id, event, ...data }, f.content),
      launch: s => f.service.handle({ action: 'OPEN_AI', sessionId: s.id, requestId: s.requestId, questionKey: s.questionKey }, f.content),
      pause: async () => { await new Promise(resolve => setTimeout(resolve, 0)); },
    });
    expect([...document.querySelectorAll('input')].map(n => n.value)).toEqual(['4', '6']);
    expect(calls).toBe(2);
    expect((await read()).phase).toBe('done');
    expect((await read()).stats).toEqual({ solved: 2, correct: 0, failed: 0 });
  });
  it('rejects provider results and cancellation from unrelated tabs', async () => {
    const f = backgroundFixture();
    const s = await f.service.store.start({ tabId: 7, url: f.content.url });
    await f.service.store.event(s.id, 'QUESTION', { target: { key: 'q1', url: s.url } });
    const waiting = await f.service.store.event(s.id, 'DISPATCH', { payload: {} });
    await f.service.store.bindTab(waiting, 10);
    const unrelated = { id: f.api.runtime.id, tab: { id: 9, url: 'https://example.test' } };
    const identity = { sessionId: s.id, requestId: waiting.requestId, questionKey: 'q1' };
    await f.service.handle({ action: 'SOLVER_JSON_RESULT', ...identity, data: { jawaban: '4' } }, unrelated);
    expect((await f.service.store.read()).answer).toBeNull();
    await expect(f.service.handle({ action: 'STOP_PROCESS', ...identity }, unrelated)).rejects.toThrow();
    expect((await f.service.store.read()).phase).toBe('waiting_for_answer');
  });
  it('allows editor writes only for the locked question during applying', async () => {
    const f = backgroundFixture();
    const s = await f.service.store.start({ tabId: 7, url: f.content.url });
    await f.service.store.event(s.id, 'QUESTION', { target: { key: 'q1', id: 'q1', type: 'coderunner', url: s.url } });
    const waiting = await f.service.store.event(s.id, 'DISPATCH', { payload: {} });
    const msg = { action: 'EDITOR_ACCESS', sessionId: s.id, id: 'q1', kind: 'ace', value: 'print(4)' };
    await expect(f.service.handle(msg, f.content)).rejects.toThrow();
    await f.service.store.answer(waiting, { jawaban: 'print(4)' });
    await f.service.store.event(s.id, 'APPLY');
    f.api.scripting.executeScript = async options => {
      expect(options.world).toBe('MAIN');
      expect(options.target.tabId).toBe(7);
      return [{ result: { ok: true, value: 'print(4)' } }];
    };
    expect(await f.service.handle(msg, f.content)).toEqual({ ok: true, value: 'print(4)' });
    await expect(f.service.handle({ ...msg, id: 'q2' }, f.content)).rejects.toThrow();
  });
});
