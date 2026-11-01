import {MARKER, TARGETS, readBinding} from './binding.js';
// This world only exposes public identifiers. Credentials never enter the webpage.
let timer;
function scan() {
  document.querySelectorAll(TARGETS).forEach(el => {
    let binding = null;
    try { binding = readBinding(el, location.href, window.__INITIAL_STATE__); } catch { /* Page component changed. */ }
    const text = binding ? JSON.stringify(binding) : null;
    if (text) { if (el.getAttribute(MARKER) !== text) el.setAttribute(MARKER, text); }
    else el.removeAttribute(MARKER);
  });
}
function schedule() {
  if (timer || document.hidden) return;
  timer = setTimeout(() => { timer = undefined; scan(); }, 120);
}
new MutationObserver(changes => {
  if (changes.every(change => change.target instanceof Element && change.target.closest('.brp-label'))) return;
  schedule();
}).observe(document, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class','href']});
window.addEventListener('popstate', schedule);
document.addEventListener('visibilitychange', schedule);
// Vue can reuse a node without changing its DOM. A bounded scan catches updated props.
setInterval(schedule, 1500);
schedule();
