import { afterEach, describe, expect, it, vi } from 'vitest';
import { backgroundFixture } from './helpers/background-fixture.js';
import { runFlow } from '../src/content/flow.js';
import { createMoodleAdapter } from '../src/content/moodle-adapter.js';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function markup() {
  document.body.innerHTML = '<div class="que shortanswer notyetanswered" id="q1"><div class="qtext">2+2</div><div class="answer"><input type="text"></div></div><div class="que shortanswer notyetanswered" id="q2"><div class="qtext">3+3</div><div class="answer"><input type="text"></div></div>';
}
describe('background and Moodle flow integration', () => {
  it('fills two deferred questions through provider tabs and stores unknown grades exactly once', async () => {
    markup();
    const f = backgroundFixture(location.href);
    let calls = 0;
    const s = await f.service.store.start({ tabId: 7, url: location.href, provider: 'gemini' });
    const read = () => f.service.handle({ action: 'SESSION_STATE' }, f.content);
    // Plays the injector: answer from the provider tab the background opened.
    const answerFromTab = async s => {
      await vi.waitFor(async () => expect((await f.service.store.read()).providerTabId).toBeTruthy());
      const tab = f.tabs.get((await f.service.store.read()).providerTabId);
      await f.service.handle({ action: 'SOLVER_JSON_RESULT', sessionId: s.id, requestId: s.requestId, questionKey: s.questionKey,
        data: { jawaban: String(++calls * 2 + 2), index_pilihan: 0 } }, { id: f.api.runtime.id, url: tab.url, tab });
    };
    await runFlow({ session: s, adapter: createMoodleAdapter(), read,
      event: (s, event, data) => f.service.handle({ action: 'SESSION_EVENT', sessionId: s.id, event, ...data }, f.content),
      launch: async s => {
        await f.service.handle({ action: 'OPEN_AI', sessionId: s.id, requestId: s.requestId, questionKey: s.questionKey }, f.content);
        await answerFromTab(s);
      },
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
  it('fetches question images only for the quiz tab while a question is being prepared', async () => {
    const f = backgroundFixture();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => png.buffer }));
    const s = await f.service.store.start({ tabId: 7, url: f.content.url });
    const msg = { action: 'FETCH_IMAGE', sessionId: s.id, url: 'https://cdn.test/a.png' };
    await expect(f.service.handle(msg, f.content)).rejects.toThrow('tidak cocok');
    await f.service.store.event(s.id, 'QUESTION', { target: { key: 'q1', id: 'q1', url: s.url } });
    expect(await f.service.handle(msg, f.content)).toBe('data:image/png;base64,iVBORw==');
    const unrelated = { id: f.api.runtime.id, url: 'https://example.test', tab: { id: 9, url: 'https://example.test' } };
    await expect(f.service.handle(msg, unrelated)).rejects.toThrow();
    await f.service.store.event(s.id, 'DISPATCH', { payload: {} });
    await expect(f.service.handle(msg, f.content)).rejects.toThrow('tidak cocok');
  });
});

describe('session state polling', () => {
  it('does not send the stored image payload to the quiz tab on every poll', async () => {
    const f = backgroundFixture();
    const s = await f.service.store.start({ tabId: 7, url: f.content.url });
    await f.service.store.event(s.id, 'QUESTION', { target: { key: 'q1', url: s.url } });
    await f.service.store.event(s.id, 'DISPATCH', { payload: { text: 'soal', dataUrl: 'data:image/png;base64,AAAA' } });
    const state = await f.service.handle({ action: 'SESSION_STATE' }, f.content);
    expect(state.phase).toBe('waiting_for_answer');
    expect(state.payload).toBeNull();
    expect((await f.service.store.read()).payload.dataUrl).toContain('base64');
  });
});
