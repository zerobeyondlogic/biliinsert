// The Vue binding strategy is adapted from Chihiro521/bili-ip-region (MIT).
// Copyright (c) 2026 Chihiro521. See licenses/bili-ip-region-MIT.txt.
export const MARKER = 'data-brp-binding';
export const TARGETS = '.bili-dyn-time,.bili-dyn-content__orig__author,.opus-module-author__pub';
export const record = value => value && typeof value === 'object' ? value : {};
export function validId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : null;
}
export function parseBinding(input) {
  const data = record(input), id = validId(data.id);
  const authorMid = data.authorMid == null ? null : validId(data.authorMid);
  return id && (data.authorMid == null || authorMid) && ['post', 'original'].includes(data.role)
    ? {id, authorMid, role: data.role} : null;
}
export function itemBinding(value, role = 'post') {
  const data = record(value), id = validId(data.id_str);
  return id ? {id, authorMid: validId(record(record(data.modules).module_author).mid), role} : null;
}
export function component(el) { return record(el?.__vue__ ?? el?.__vueParentComponent); }
export function props(el) { const comp = component(el); return record(comp.$props ?? comp.props); }
export function pageId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 't.bilibili.com') return validId(parsed.pathname.match(/^\/(\d+)\/?$/)?.[1]);
    if (parsed.hostname === 'www.bilibili.com') return validId(parsed.pathname.match(/^\/opus\/(\d+)\/?$/)?.[1]);
  } catch { /* Not a content URL. */ }
  return null;
}
function findBinding(el, href, initialState) {
  const original = el.matches('.bili-dyn-content__orig__author');
  const card = el.closest('.bili-dyn-item');
  // The outer card is authoritative. Never assign its location to a repost's original.
  if (card) {
    const cp = props(card), cc = component(card);
    const data = cp.data ?? cp.item ?? cc.data;
    if (validId(record(data).id_str)) return itemBinding(original ? record(data).orig : data, original ? 'original' : 'post');
  }
  if (!original) {
    const local = props(el), owner = component(el);
    const id = validId(local.id ?? owner.id);
    if (id) return {id, authorMid: validId(record(local.author ?? owner.author).mid), role:'post'};
  }
  for (let node = el; node; node = node.parentElement) {
    const local = props(node), owner = component(node);
    const data = local.data ?? local.item ?? owner.data;
    const found = itemBinding(original ? record(data).orig : data, original ? 'original' : 'post');
    if (found) return found;
    if (node === card || (!card && node.matches('.opus-module-author'))) break;
  }
  if (original) return null;
  const id = pageId(href), detail = record(record(initialState).detail);
  if (id && detail.id_str === id) {
    const author = record(props(el.closest('.opus-module-author') ?? el).data);
    return {id, authorMid: validId(author.mid ?? record(detail.basic).uid), role:'post'};
  }
  return null;
}
export function readBinding(el, href, initialState) {
  const binding = findBinding(el, href, initialState);
  const currentId = pageId(href);
  // Details can retain the previous Vue component for a moment during SPA navigation.
  if (binding?.role === 'post' && currentId && binding.id !== currentId) return null;
  return binding;
}
