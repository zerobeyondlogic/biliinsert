// ISOLATED world bridges one preference only. No credentials or private data.
import { COMMENT_CHANNEL } from './comments-data.js';
let commentsEnabled = true;
function publish() {
  window.postMessage({channel: COMMENT_CHANNEL, type: 'settings', commentsEnabled}, location.origin);
}
window.addEventListener('message', event => {
  if (event.source === window && event.origin === location.origin && event.data?.channel === COMMENT_CHANNEL && event.data.type === 'ready') publish();
});
chrome.storage.sync.get('settings').then(data => {
  commentsEnabled = data.settings?.comments !== false;
  publish();
}).catch(() => publish());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  commentsEnabled = changes.settings.newValue?.comments !== false;
  publish();
});
