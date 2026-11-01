import {MARKER, TARGETS, parseBinding, validId} from './binding.js';

let settings = {profile:false, dynamic:false}, timer, profileState, inFlight = 0, lastHref = location.href;
const states = new Map(), visible = new Set();
const profileSelector = '.upinfo-detail__top,.h-basic > div';
function read(el) {
  try { return parseBinding(JSON.parse(el.getAttribute(MARKER) || 'null')); } catch { return null; }
}
function schedule() {
  if (timer || document.hidden) return;
  timer = setTimeout(() => { timer = undefined; update(); }, 120);
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target);
  schedule();
}, {rootMargin:'400px'});
function remove(state) { state?.label?.remove(); if (state) state.label = null; }
function region(text) {
  if (typeof text !== 'string' || text.length > 100) return null;
  const result = text.replace(/^IP\s*(?:归属地|属地)\s*[:：]?\s*/i, '').trim();
  return result && !/^(未知|未知地区|未知属地|暂无|无|--)$/.test(result) ? result : null;
}
function place(el, state, kind) {
  const value = state.result?.ok ? region(state.result.location) : null;
  if (!value || !settings[kind]) { remove(state); return; }
  let label = state.label;
  if (!label) {
    label = document.createElement('span'); label.className = 'brp-label'; state.label = label;
    label.dataset.brpKind = kind;
  }
  const text = `IP属地：${value}`;
  if (label.textContent !== text) label.textContent = text;
  label.title = kind === 'profile' ? 'B站个人主页公开的 IP 属地，与单条内容发表时的属地可能不同'
    : `${state.binding.role === 'original' ? '原动态' : '这条动态'}发表时的 IP 属地`;
  label.dataset.brpId = kind === 'profile' ? state.mid : state.binding.id;
  const metadataStyle = getComputedStyle(el);
  const size = kind === 'profile' ? `${Math.min(14, parseFloat(metadataStyle.fontSize) || 14)}px` : metadataStyle.fontSize;
  const color = kind === 'profile' ? '#fff' : metadataStyle.color;
  if (label.style.getPropertyValue('--brp-font-size') !== size) label.style.setProperty('--brp-font-size', size);
  if (label.style.getPropertyValue('--brp-color') !== color) label.style.setProperty('--brp-color', color);
  if (kind === 'dynamic' && el.matches('.bili-dyn-time')) {
    if (el.nextSibling !== label) el.after(label);
  } else if (label.parentElement !== el) el.append(label);
}
function reset() {
  for (const [el, state] of states) { remove(state); observer.unobserve(el); }
  states.clear(); visible.clear(); remove(profileState); profileState = null; schedule();
}
function getMid() {
  return location.hostname === 'space.bilibili.com' ? validId(location.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1]) : null;
}
async function loadProfile(el, state) {
  state.loading = true;
  try {
    const result = await chrome.runtime.sendMessage({type:'GET_PROFILE',mid:state.mid});
    if (profileState !== state || getMid() !== state.mid || !el.isConnected) return;
    state.result = result?.ok && result.mid && result.mid !== state.mid ? null : result;
    state.next = Date.now() + (result?.ok ? 5 * 60000 : 60000);
    el.dataset.brpStatus = result?.ok ? (result.location ? 'ok' : 'empty') : result?.reason || 'error';
    place(el, state, 'profile');
  } catch { state.next = Date.now() + 60000; state.result = null; remove(state); el.dataset.brpStatus = 'error'; }
  finally { state.loading = false; }
}
async function loadDynamic(el, state) {
  state.loading = true; inFlight++;
  try {
    const result = await chrome.runtime.sendMessage({type:'GET_DYNAMIC',id:state.binding.id,expectedMid:state.binding.authorMid});
    if (states.get(el) !== state || JSON.stringify(read(el)) !== state.signature || !el.isConnected) return;
    const matches = result?.id === state.binding.id && (!state.binding.authorMid || result.authorMid === state.binding.authorMid);
    state.result = result?.ok && !matches ? null : result;
    state.next = Date.now() + (result?.ok ? 5 * 60000 : 60000);
    el.dataset.brpStatus = state.result?.ok ? (state.result.location ? 'ok' : 'empty') : state.result?.reason || 'error';
    place(el, state, 'dynamic');
  } catch { state.next = Date.now() + 60000; state.result = null; remove(state); el.dataset.brpStatus = 'error'; }
  finally { state.loading = false; inFlight--; schedule(); }
}
function update() {
  if (lastHref !== location.href) { lastHref = location.href; reset(); }
  const mid = getMid(), profileEl = mid && document.querySelector(profileSelector);
  if (!settings.profile || !profileEl || profileState?.mid !== mid || profileState?.el !== profileEl) {
    remove(profileState); profileState = null;
  }
  if (settings.profile && profileEl) {
    if (!profileState) profileState = {mid,el:profileEl,next:0,loading:false};
    place(profileEl, profileState, 'profile');
    if (!profileState.loading && Date.now() >= profileState.next) void loadProfile(profileEl, profileState);
  }
  for (const [el, state] of states) {
    if (!el.isConnected || !el.matches(TARGETS) || !read(el) || !settings.dynamic) {
      remove(state); states.delete(el); observer.unobserve(el); visible.delete(el);
    }
  }
  if (!settings.dynamic) return;
  for (const el of document.querySelectorAll(`[${MARKER}]`)) {
    if (!el.matches(TARGETS)) continue;
    const binding = read(el); if (!binding) continue;
    const signature = JSON.stringify(binding);
    let state = states.get(el);
    if (!state || state.signature !== signature) {
      remove(state); state = {binding,signature,next:0,loading:false}; states.set(el, state); observer.observe(el);
    }
    place(el, state, 'dynamic');
    if (visible.has(el) && !state.loading && Date.now() >= state.next && inFlight < 3) void loadDynamic(el, state);
  }
}
chrome.storage.sync.get('settings').then(data => {
  settings = {profile:data.settings?.profile !== false,dynamic:data.settings?.dynamic !== false}; reset();
}).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  settings = {profile:changes.settings.newValue?.profile !== false,dynamic:changes.settings.newValue?.dynamic !== false}; reset();
});
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'AUTH_CHANGED') reset(); });
new MutationObserver(changes => {
  if (changes.every(change => (change.target instanceof Element && change.target.closest('.brp-label')) ||
    (change.type === 'childList' && [...change.addedNodes,...change.removedNodes].every(n => n instanceof Element && n.matches('.brp-label'))))) return;
  schedule();
}).observe(document, {childList:true,subtree:true,attributes:true,attributeFilter:[MARKER]});
document.addEventListener('visibilitychange', schedule);
window.addEventListener('popstate', schedule);
setInterval(schedule, 1500);
schedule();
