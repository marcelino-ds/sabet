import { createBackground } from './service.js';
import { PROVIDERS } from '../shared/providers.js';

const service = createBackground(chrome);
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
// Mode API sudah dihapus: jangan biarkan API key lama tertinggal di storage.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.remove(['apiMode', ...Object.keys(PROVIDERS).flatMap(id => ['apiKey_' + id, 'model_' + id])]).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  service.handle(message, sender)
    .then(value => respond({ ok: true, value }))
    .catch(error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { void service.alarm(alarm); });
chrome.tabs.onUpdated.addListener((id, info) => { void service.tabUpdated(id, info); });
chrome.tabs.onRemoved.addListener(id => { void service.tabRemoved(id); });
