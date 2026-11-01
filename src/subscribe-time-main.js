import {
  SUBSCRIBE_CHANNEL, SUBSCRIBE_LABEL, userId, spaceContext, relationRequest,
  viewerFromResponse, profileFollowTime, listFollowTimes, relationKey, listTimeCaption, formatFollowTime,
} from './subscribe-time-data.js';

// MAIN world: standard webpage requests use the browser's existing login.
// No document.cookie / extension cookie API / App token is used by this feature.
const originalFetch = window.fetch;
const listCache = new Map(), profileCache = new Map(), pendingProfiles = new Set();
const positioned = new Map();
const PROFILE_TARGET = '.space-head-follow.b-follow,.h-action .h-f-btn';
const CARD_ANCHOR = '.relation-card-info__uname,.follow-list .fans-name,.fans-list .fans-name';
const CACHE_MS = 60_000;
let enabled = false, viewer, navNext = 0, navPending = false, timer;
let href = location.href, generation = 0, mutationEpoch = 0, navSequence = 0;

function boundedSet(map, key, value, limit) {
  map.delete(key); map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}
function restorePositions() {
  for (const [element, original] of positioned) {
    if (element.isConnected && element.querySelector(`${SUBSCRIBE_LABEL}[data-brp-subscribe-kind="profile"]`)) continue;
    if (!element.isConnected) element.querySelectorAll(SUBSCRIBE_LABEL).forEach(label => label.remove());
    if (element.style.position === 'relative') {
      if (original.value) element.style.setProperty('position', original.value, original.priority);
      else element.style.removeProperty('position');
    }
    positioned.delete(element);
  }
}
function removeLabels() { document.querySelectorAll(SUBSCRIBE_LABEL).forEach(label => label.remove()); restorePositions(); }
function setViewer(next) {
  if (viewer !== next) {
    if (viewer !== undefined) { listCache.clear(); mutationEpoch++; }
    viewer = next; generation++; profileCache.clear(); removeLabels();
  }
  navNext = Date.now() + CACHE_MS;
}
function consume(request, body, requestContext) {
  if (!request) return;
  if (request.kind === 'viewer') {
    if (requestContext?.navSequence !== navSequence) return;
    if (body?.code === 0 || body?.code === -101) setViewer(viewerFromResponse(body));
  } else if (request.kind === 'list') {
    if (requestContext?.mutationEpoch !== mutationEpoch) return;
    for (const row of listFollowTimes(request, body)) {
      boundedSet(listCache, relationKey(row.owner, row.section, row.mid), { ...row, expires: Date.now() + 10 * CACHE_MS }, 1000);
    }
  } else if (request.kind === 'profile' && viewer && requestContext?.viewer === viewer && requestContext?.generation === generation) {
    boundedSet(profileCache, `${viewer}:${request.target}`, {
      time: profileFollowTime(body, request.target, viewer), expires: Date.now() + CACHE_MS,
    }, 100);
  } else if (request.kind === 'mutation' && body?.code === 0) {
    generation++; mutationEpoch++; profileCache.clear(); listCache.clear(); removeLabels();
  }
  schedule();
}

// Capture only relation responses. Preserve the original response for Bilibili.
window.fetch = new Proxy(originalFetch, {
  apply(target, thisArg, args) {
    const request = relationRequest(args[0], location.href);
    const requestContext = { viewer, generation, mutationEpoch, navSequence: request?.kind === 'viewer' ? ++navSequence : null };
    const result = Reflect.apply(target, thisArg, args);
    if (!request) return result;
    void result.then(response => {
      if (response.ok) void response.clone().json().then(body => consume(request, body, requestContext)).catch(() => {});
    }).catch(() => {});
    return result;
  },
});
const xhrRequests = new WeakMap();
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = new Proxy(originalOpen, {
  apply(target, thisArg, args) {
    xhrRequests.set(thisArg, { request: relationRequest(args[1], location.href) });
    return Reflect.apply(target, thisArg, args);
  },
});
XMLHttpRequest.prototype.send = new Proxy(originalSend, {
  apply(target, thisArg, args) {
    const state = xhrRequests.get(thisArg);
    const requestContext = { viewer, generation, mutationEpoch, navSequence: state?.request?.kind === 'viewer' ? ++navSequence : null };
    if (state?.request) thisArg.addEventListener('load', () => {
      if (xhrRequests.get(thisArg) !== state || thisArg.status < 200 || thisArg.status >= 300) return;
      try {
        if (thisArg.responseType === 'json') consume(state.request, thisArg.response, requestContext);
        else if (!thisArg.responseType || thisArg.responseType === 'text') consume(state.request, JSON.parse(thisArg.responseText), requestContext);
      } catch { /* An incompatible response is not a follow time. */ }
    }, { once: true });
    return Reflect.apply(target, thisArg, args);
  },
});

async function requestJson(path) {
  const response = await Reflect.apply(originalFetch, window, [`https://api.bilibili.com${path}`, {
    credentials: 'include', signal: AbortSignal.timeout(10_000),
  }]);
  if (!response.ok) throw new Error('request-failed');
  return response.json();
}
async function ensureViewer() {
  if (navPending || Date.now() < navNext) return;
  const sequence = ++navSequence;
  navPending = true; navNext = Date.now() + CACHE_MS;
  try {
    const body = await requestJson('/x/web-interface/nav');
    if (sequence !== navSequence) return;
    if (body?.code === 0 || body?.code === -101) setViewer(viewerFromResponse(body));
    else setViewer(undefined);
  } catch { if (sequence === navSequence) setViewer(undefined); }
  finally { navPending = false; schedule(); }
}
async function ensureProfile(target) {
  if (!viewer || target === viewer || navPending) return;
  const key = `${viewer}:${target}`, cached = profileCache.get(key);
  if (pendingProfiles.has(key) || cached?.expires > Date.now()) return;
  const requestGeneration = generation, requestViewer = viewer;
  pendingProfiles.add(key);
  boundedSet(profileCache, key, { time: null, expires: Date.now() + CACHE_MS }, 100);
  try {
    const body = await requestJson(`/x/web-interface/relation?mid=${target}`);
    if (generation !== requestGeneration || viewer !== requestViewer) return;
    boundedSet(profileCache, key, { time: profileFollowTime(body, target, requestViewer), expires: Date.now() + CACHE_MS }, 100);
  } catch { /* A failed query never produces a label. */ }
  finally { pendingProfiles.delete(key); schedule(); }
}

function labelAfter(anchor, key, caption, time, used, block = false) {
  const parent = anchor.parentElement;
  if (!parent) return;
  let label = [...parent.children].find(child => child.matches(SUBSCRIBE_LABEL) && child.dataset.brpSubscribeKey === key);
  if (!label) { label = document.createElement('span'); label.dataset.brpSubscribeTime = ''; label.dataset.brpSubscribeKey = key; }
  const text = `${caption} ${formatFollowTime(time)}`;
  if (label.textContent !== text) label.textContent = text;
  label.title = 'B站返回的关注关系时间（浏览器本地时间）；重新关注可能改变时间';
  const css = `display:${block ? 'block' : 'inline-block'};margin:${block ? '4px 0 0' : '0 0 0 8px'};padding:0;border:0;background:transparent;color:var(--text3,#9499a0);font-size:12px;font-family:inherit;font-weight:400;line-height:1.6;white-space:normal;vertical-align:middle;`;
  if (!label.style.cssText) label.style.cssText = css;
  if (anchor.nextElementSibling !== label) anchor.after(label);
  used.add(label);
}
function profileLabel(button, key, time, used) {
  let label = [...button.children].find(child => child.matches(SUBSCRIBE_LABEL));
  if (!label) {
    label = document.createElement('span'); label.dataset.brpSubscribeTime = '';
    label.dataset.brpSubscribeKind = 'profile'; label.setAttribute('aria-hidden', 'true');
    if (getComputedStyle(button).position === 'static' && !positioned.has(button)) {
      positioned.set(button, { value: button.style.getPropertyValue('position'), priority: button.style.getPropertyPriority('position') });
      button.style.position = 'relative';
    }
    label.style.cssText = 'position:absolute;inset-block-end:calc(100% + 6px);inset-inline-start:0;display:block;width:max-content;max-width:min(280px,calc(100vw - 24px));margin:0;padding:0;border:0;background:transparent;color:#fff;font-size:12px;font-family:inherit;font-weight:400;line-height:1.6;white-space:normal;pointer-events:none;text-align:start;';
    button.append(label);
  }
  label.dataset.brpSubscribeKey = key;
  const text = `你关注 Ta 于 ${formatFollowTime(time)}`;
  if (label.textContent !== text) label.textContent = text;
  label.title = 'B站返回的关注关系时间（浏览器本地时间）；重新关注可能改变时间';
  const bounds = button.getBoundingClientRect(), viewport = document.documentElement.clientWidth;
  const left = Math.min(Math.max(bounds.left, 12), Math.max(12, viewport - 12 - label.offsetWidth));
  const offset = `${Math.round(left - bounds.left)}px`;
  if (label.style.insetInlineStart !== offset) label.style.insetInlineStart = offset;
  used.add(label);
}
function scan() {
  if (href !== location.href) { href = location.href; generation++; removeLabels(); }
  const context = spaceContext(location.href), used = new Set();
  if (!enabled || !context) { removeLabels(); return; }
  const button = document.querySelector(PROFILE_TARGET);
  if ((button || context.section) && Date.now() >= navNext && !navPending) void ensureViewer();
  if (button) {
    if (viewer && !navPending && viewer !== context.owner) {
      void ensureProfile(context.owner);
      const cache = profileCache.get(`${viewer}:${context.owner}`);
      const buttonText = [...button.childNodes].filter(node => !(node instanceof Element && node.matches(SUBSCRIBE_LABEL)))
        .map(node => node.textContent).join('').trim();
      const unFollowed = /^(?:\+\s*)?关注$/.test(buttonText);
      if (!unFollowed && cache?.expires > Date.now() && cache.time && !button.parentElement.querySelector('.subscribe-time-text')) {
        profileLabel(button, `profile:${viewer}:${context.owner}`, cache.time, used);
      }
    }
  }
  if (context.section) {
    for (const anchor of [...document.querySelectorAll(CARD_ANCHOR)].slice(0, 500)) {
      const mid = spaceContext(anchor.href)?.owner;
      const card = anchor.closest('.relation-card-info,.list-item');
      if (!mid || !card || card.querySelector('.relation-card-info__time')) continue;
      const key = relationKey(context.owner, context.section, mid), row = listCache.get(key);
      if (!row || row.expires < Date.now()) continue;
      labelAfter(card.querySelector('.relation-card-info__sign,.fans-desc') || anchor,
        `list:${key}`, listTimeCaption(context.owner, context.section, viewer), row.time, used, true);
    }
  }
  document.querySelectorAll(SUBSCRIBE_LABEL).forEach(label => { if (!used.has(label)) label.remove(); });
  restorePositions();
}
function schedule() {
  if (timer || document.hidden) return;
  timer = setTimeout(() => { timer = undefined; scan(); }, 120);
}
function owned(node) { return (node instanceof Element ? node : node?.parentElement)?.closest(SUBSCRIBE_LABEL); }
new MutationObserver(changes => {
  if (changes.every(change => owned(change.target) || (change.type === 'childList' && [...change.addedNodes, ...change.removedNodes].every(owned)))) return;
  schedule();
}).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'class'] });
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== SUBSCRIBE_CHANNEL
      || event.data.type !== 'settings' || typeof event.data.enabled !== 'boolean') return;
  enabled = event.data.enabled;
  if (!enabled) { generation++; removeLabels(); }
  schedule();
});
window.addEventListener('popstate', schedule);
document.addEventListener('visibilitychange', schedule);
setInterval(schedule, 1500);
window.postMessage({ channel: SUBSCRIBE_CHANNEL, type: 'ready' }, location.origin);
