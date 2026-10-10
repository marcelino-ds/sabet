import { createBackground } from '../../src/background/service.js';

export function backgroundFixture(url = 'https://lms.test/mod/quiz/attempt.php?attempt=1') {
  const data = {};
  const sent = [];
  const tabs = new Map([[7, { id: 7, url, windowId: 1 }]]);
  let nextTab = 10;
  const api = {
    runtime: { id: 'sabet-test' },
    storage: { local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])),
      set: async patch => Object.assign(data, structuredClone(patch)),
    } },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('Tab missing'); return tabs.get(id); },
      create: async options => { const t = { id: nextTab++, windowId: 1, ...options }; tabs.set(t.id, t); return t; },
      update: async (id, patch) => { const tab = tabs.get(id); Object.assign(tab, patch); return tab; },
      remove: async id => { tabs.delete(id); },
      sendMessage: async (id, message) => { sent.push({ id, message }); return { ok: true }; },
    },
    alarms: { create: async () => {}, clear: async () => {} },
    scripting: { executeScript: async () => [{ result: true }] },
  };
  const service = createBackground(api);
  const popup = { id: api.runtime.id, url: 'chrome-extension://sabet-test/popup.html' };
  const content = { id: api.runtime.id, url, tab: tabs.get(7) };
  return { service, api, data, sent, tabs, popup, content };
}
