// Lit/bbComment hook strategy adapted from MaxChang3/BiliReveal (MIT).
// Copyright (c) 2023-present MaxChang3. See licenses/BiliReveal-MIT.txt.
// Shadow DOM traversal and data collection adapted from Chihiro521/bili-ip-region
// (MIT), copyright (c) 2026 Chihiro521. See licenses/bili-ip-region-MIT.txt.
import { COMMENT_CHANNEL, COMMENT_TAG, COMMENT_OWNED, COMMENT_LEGACY, cachedComment, collectComments, commentId, commentRegion, isCommentRequest, replyRecord } from './comments-data.js';

// This module stays in MAIN world. Only the comments preference crosses worlds.
const regions = new Map(), roots = new Map(), pending = new Set(), patched = new WeakSet();
let enabled = false, timer;

function isOwned(node) {
  return (node instanceof Element ? node : node?.parentElement)?.closest(COMMENT_OWNED) != null;
}
function schedule(root = document) {
  pending.add(root);
  if (timer !== undefined || document.hidden) return;
  timer = setTimeout(() => {
    timer = undefined;
    const batch = [...pending]; pending.clear();
    for (const root of batch) try { scan(root); } catch { /* The page may replace a component during scanning. */ }
    for (const [root, observer] of roots) if (root instanceof ShadowRoot && !root.host.isConnected) {
      observer.disconnect(); roots.delete(root);
    }
  }, 80);
}
function observe(root) {
  if (roots.has(root)) return;
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (isOwned(mutation.target)) continue;
      const changes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changes.length && changes.every(isOwned)) continue;
      if (mutation.type === 'childList') for (const node of mutation.addedNodes) if (node instanceof Element) schedule(node);
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      if (!target) { schedule(root); continue; }
      if (target === document.body || target === document.documentElement) {
        if (mutation.type === 'attributes') schedule(document);
      } else {
        const comment = target.closest(COMMENT_LEGACY), tree = target.getRootNode();
        // Video progress clocks and unrelated UI updates must not rescan the page.
        schedule(comment ?? (tree instanceof ShadowRoot && tree.host.localName === COMMENT_TAG ? tree : target));
      }
    }
  });
  observer.observe(root, {subtree:true, childList:true, characterData:true, attributes:true,
    attributeFilter:['data-id', 'data-rpid', 'data-oid', 'class', 'style']});
  roots.set(root, observer);
}

function duplicateLocation(time, parent, location) {
  // BiliReveal adds #location/.reply-location or appends text inside the time.
  if (/IP\s*(?:归属地|属地)\s*[:：]/i.test(time.textContent || '')) return true;
  for (const element of parent.children) {
    if (element === time || element.matches(COMMENT_OWNED)) continue;
    if (element.matches('#location,.reply-location,.reply-ip-location,.ip-location,[data-bili-ip-region]')) {
      if (element.textContent?.trim()) return true;
    }
    if (/IP\s*(?:归属地|属地)\s*[:：]/i.test(element.textContent || '')) return true;
    if (element.matches('.location') && commentRegion(element.textContent) === location) return true;
  }
  return false;
}
function place(time, location, id, oid = null) {
  const parent = time?.parentNode;
  if (!time || !(parent instanceof Element || parent instanceof ShadowRoot)) return;
  const labels = [...parent.children].filter(el => el.matches(COMMENT_OWNED));
  if (!enabled || !location || !id || duplicateLocation(time, parent, location)) {
    labels.forEach(label => label.remove()); return;
  }
  let label = labels.shift(); labels.forEach(extra => extra.remove());
  if (!label) { label = document.createElement('span'); label.dataset.brpCommentLocation = ''; }
  const text = `IP属地：${location}`;
  if (label.textContent !== text) label.textContent = text;
  label.dataset.brpReplyId = id;
  if (oid) label.dataset.brpOid = oid; else delete label.dataset.brpOid;
  label.title = '这条评论发表时的 IP 属地';
  const style = getComputedStyle(time);
  const css = `display:inline-block;margin-inline-start:8px;padding:0;border:0;border-radius:0;background:transparent;color:${style.color};font-size:${style.fontSize};font-family:${style.fontFamily};font-weight:${style.fontWeight};line-height:${style.lineHeight};white-space:nowrap;vertical-align:baseline;`;
  if (label.style.cssText !== css) label.style.cssText = css;
  if (time.nextElementSibling !== label) time.after(label);
}

function renderLit(node) {
  const root = node.shadowRoot;
  if (!root) return;
  const record = replyRecord(node.data);
  const time = root.querySelector('#pubdate');
  const location = record?.hasLocation ? record.location : record ? cachedComment(regions, record.id, record.oid) : null;
  place(time, location, record?.id, record?.oid);
  for (const label of root.querySelectorAll(COMMENT_OWNED)) {
    if (!enabled || !record || label.dataset.brpReplyId !== record.id || label.previousElementSibling !== time) label.remove();
  }
}
function candidateReply(props, sub, id) {
  if (!props || typeof props !== 'object') return null;
  // A subreply must never inherit the enclosing parent reply just because it is
  // the first ancestor with data. Accept generic reply only when an ID confirms it.
  const candidate = sub ? props.subReply ?? props.subreply ?? (id ? props.reply : null) : props.reply;
  const record = replyRecord(candidate);
  return record && (!id || id === record.id) ? candidate : null;
}
function componentReply(node, attributeId) {
  const sub = node.matches('.sub-reply-item') || !!node.closest('.sub-reply-list');
  const vueRecords = Array.isArray(node.__vue__) ? node.__vue__ : [node.__vue__];
  for (const vue of vueRecords) {
    const value = candidateReply(vue?.vnode?.props ?? vue?.$props ?? vue?.props, sub, attributeId);
    if (value) return value;
  }
  let component = node.__vueParentComponent;
  for (let depth = 0; component && depth < 6; depth++, component = component.parent) {
    if (depth && component.vnode?.el instanceof Element && component.vnode.el !== node && component.vnode.el.matches(COMMENT_LEGACY)) break;
    const value = candidateReply(component.props ?? component.vnode?.props, sub, attributeId);
    if (value) return value;
  }
  return null;
}
function renderLegacy(node) {
  const attributeId = commentId(node.getAttribute('data-rpid') ?? node.getAttribute('data-id'));
  const data = componentReply(node, attributeId), record = replyRecord(data);
  const id = attributeId ?? record?.id ?? null;
  const oid = commentId(node.getAttribute('data-oid')) ?? record?.oid ?? null;
  const location = record?.hasLocation ? record.location : id ? cachedComment(regions, id, oid) : null;
  const time = [...node.querySelectorAll('.reply-time,.sub-reply-time,.reply-info .time,.sub-reply-info .time,.info .time')]
    .find(element => element.closest(COMMENT_LEGACY) === node) ?? null;
  place(time, location, id, oid);
  for (const label of node.querySelectorAll(COMMENT_OWNED)) {
    if (label.closest(COMMENT_LEGACY) !== node) continue;
    if (!enabled || !id || label.dataset.brpReplyId !== id || label.previousElementSibling !== time) label.remove();
  }
}
function scan(root) {
  if (!(root instanceof Element || root instanceof ShadowRoot || root === document)) return;
  if (root instanceof Element && !root.isConnected) return;
  if (root instanceof ShadowRoot && !root.host.isConnected) return;
  if (root === document || root instanceof ShadowRoot) observe(root);
  if (root instanceof ShadowRoot && root.host.localName === COMMENT_TAG) renderLit(root.host);
  const elements = [...root.querySelectorAll('*')];
  if (root instanceof Element) elements.unshift(root);
  for (const element of elements) {
    if (element.localName === COMMENT_TAG) renderLit(element);
    else if (element.matches(COMMENT_LEGACY)) renderLegacy(element);
    if (element.shadowRoot) { observe(element.shadowRoot); scan(element.shadowRoot); }
  }
}
function remember(value) {
  if (collectComments(value, regions)) schedule(document);
}

function patchLit(constructor) {
  const prototype = constructor?.prototype;
  if (!prototype || typeof prototype.update !== 'function' || patched.has(prototype)) return;
  const original = prototype.update;
  prototype.update = new Proxy(original, {apply(target, receiver, args) {
    const value = Reflect.apply(target, receiver, args);
    try { renderLit(receiver); } catch { /* Preserve the component's lifecycle result. */ }
    return value;
  }});
  patched.add(prototype);
}
try {
  const originalDefine = customElements.define;
  customElements.define = new Proxy(originalDefine, {apply(target, receiver, args) {
    if (args[0] === COMMENT_TAG) try { patchLit(args[1]); } catch { /* Readonly prototypes still work through observers. */ }
    return Reflect.apply(target, receiver, args);
  }});
  patchLit(customElements.get(COMMENT_TAG));
} catch { /* Keep scanning already registered components. */ }
try {
  const originalAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = new Proxy(originalAttach, {apply(target, receiver, args) {
    const root = Reflect.apply(target, receiver, args);
    try { if (args[0]?.mode === 'open') { observe(root); schedule(root); } } catch { /* Preserve native attachShadow. */ }
    return root;
  }});
} catch { /* Existing open shadow roots are still traversed. */ }

function patchLegacy(constructor) {
  const prototype = constructor?.prototype;
  if (!prototype) return;
  for (const name of ['_createListCon', '_createSubReplyItem']) {
    const original = prototype[name];
    if (typeof original !== 'function' || patched.has(original)) continue;
    const wrapper = new Proxy(original, {apply(target, receiver, args) {
      const value = Reflect.apply(target, receiver, args);
      try { remember(args[0]); } catch { /* Return the exact original HTML/object. */ }
      return value;
    }});
    prototype[name] = wrapper; patched.add(wrapper);
  }
}
try {
  patchLegacy(window.bbComment);
  const descriptor = Object.getOwnPropertyDescriptor(window, 'bbComment');
  if (!descriptor || (descriptor.configurable && descriptor.writable && !descriptor.get && !descriptor.set)) {
    let value = window.bbComment;
    Object.defineProperty(window, 'bbComment', {configurable:true, enumerable:descriptor?.enumerable ?? true,
      get:() => value, set:next => { value = next; try { patchLegacy(next); } catch { /* Keep assignment semantics. */ } }});
  }
} catch { /* A pre-existing accessor is not replaced. */ }
try {
  const originalFetch = window.fetch;
  window.fetch = new Proxy(originalFetch, {apply(target, receiver, args) {
    const value = Reflect.apply(target, receiver, args);
    try {
      const input = args[0], url = input instanceof Request ? input.url : String(input);
      if (isCommentRequest(url, location.href)) void value.then(response => {
        try { if (response.ok) void response.clone().json().then(remember).catch(() => {}); } catch { /* Do not consume the original body. */ }
      }).catch(() => {});
    } catch { /* The page receives the original promise, including any rejection. */ }
    return value;
  }});
} catch { /* Fetch may be readonly in an uncommon host environment. */ }
try {
  const urls = new WeakMap(), watched = new WeakSet(), originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = new Proxy(originalOpen, {apply(target, receiver, args) {
    const value = Reflect.apply(target, receiver, args);
    try {
      urls.set(receiver, String(args[1]));
      if (!watched.has(receiver)) {
        watched.add(receiver);
        receiver.addEventListener('load', () => {
          if (!isCommentRequest(urls.get(receiver), location.href) || receiver.status < 200 || receiver.status >= 300) return;
          try { remember(receiver.responseType === 'json' ? receiver.response : JSON.parse(receiver.responseText)); } catch { /* Ignore non-JSON/error bodies. */ }
        });
      }
    } catch { /* Preserve native open return and side effects. */ }
    return value;
  }});
} catch { /* Readonly host prototypes are left unchanged. */ }

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== COMMENT_CHANNEL
    || event.data.type !== 'settings' || typeof event.data.commentsEnabled !== 'boolean') return;
  enabled = event.data.commentsEnabled; schedule(document);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(document); });
window.addEventListener('popstate', () => schedule(document));
// Handles Vue's property-only node reuse and registration after document_start.
setInterval(() => { if (!document.hidden) { try { patchLegacy(window.bbComment); } catch {} schedule(document); } }, 2500);
window.postMessage({channel: COMMENT_CHANNEL, type:'ready'}, location.origin);
schedule(document);
