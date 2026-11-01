// Only the display preference crosses into MAIN world; no account credential.
import { SUBSCRIBE_CHANNEL } from './subscribe-time-data.js';
let enabled = false, loaded = false;
function publish() {
  if (loaded) window.postMessage({ channel: SUBSCRIBE_CHANNEL, type: 'settings', enabled }, location.origin);
}
window.addEventListener('message', event => {
  if (event.source === window && event.origin === location.origin && event.data?.channel === SUBSCRIBE_CHANNEL
      && event.data.type === 'ready') publish();
});
chrome.storage.sync.get('settings').then(data => {
  enabled = data.settings?.subscribeTime !== false; loaded = true; publish();
}).catch(() => { loaded = true; publish(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  enabled = changes.settings.newValue?.subscribeTime !== false; loaded = true; publish();
});
