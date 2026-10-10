import { afterEach, describe, expect, it, vi } from 'vitest';
import * as browser from '../src/shared/browser.js';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('extension RPC boundary', () => {
  it('unwraps acknowledged results and rejects errors instead of proceeding', async () => {
    expect(browser.rpc).toBeTypeOf('function');
    vi.stubGlobal('chrome', { runtime: { sendMessage: (_m, cb) => cb({ ok: true, value: { id: 's1' } }) } });
    expect(await browser.rpc({ action: 'SESSION_STATE' })).toEqual({ id: 's1' });
    chrome.runtime.sendMessage = (_m, cb) => cb({ ok: true, value: null });
    expect(await browser.rpc({ action: 'SESSION_STATE' })).toBeNull();
    chrome.runtime.sendMessage = (_m, cb) => cb({ ok: false, error: 'Stale session' });
    await expect(browser.rpc({ action: 'SESSION_EVENT' })).rejects.toThrow('Stale session');
  });
  it('times out a worker that never acknowledges and cancels pending waits', async () => {
    expect(browser.rpc).toBeTypeOf('function');
    expect(browser.delay).toBeTypeOf('function');
    vi.useFakeTimers();
    vi.stubGlobal('chrome', { runtime: { sendMessage: () => {} } });
    const request = browser.rpc({}, 100);
    const assertion = expect(request).rejects.toThrow(/respons/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    const ctrl = new AbortController();
    const wait = browser.delay(10000, ctrl.signal);
    ctrl.abort();
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
