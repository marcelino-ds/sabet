import { createBackground } from './service.js';

const service = createBackground(chrome);
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  service.handle(message, sender)
    .then(value => respond({ ok: true, value }))
    .catch(error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { void service.alarm(alarm); });
chrome.tabs.onUpdated.addListener((id, info) => { void service.tabUpdated(id, info); });
chrome.tabs.onRemoved.addListener(id => { void service.tabRemoved(id); });
