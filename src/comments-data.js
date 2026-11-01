// Reply-data extraction follows BiliReveal / Chihiro521/bili-ip-region (MIT).
// Copyright (c) 2023-present MaxChang3; Copyright (c) 2026 Chihiro521.
// See licenses/BiliReveal-MIT.txt and licenses/bili-ip-region-MIT.txt.
// Only the reply ID, content ID and public location survive extraction.
export const COMMENT_CHANNEL = 'bili-region-plus:comments:v1';
export const COMMENT_TAG = 'bili-comment-action-buttons-renderer';
export const COMMENT_OWNED = '[data-brp-comment-location]';
export const COMMENT_LEGACY = '.reply-item,.sub-reply-item,.list-item[data-id],.reply-wrap[data-id],.reply-wrap[data-rpid]';

export function commentId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : null;
}
export function commentRegion(value) {
  if (typeof value !== 'string') return null;
  const region = value.trim().replace(/^IP\s*(?:归属地|属地)\s*[:：]?\s*/i, '').trim();
  return region && region.length <= 80 && !/[\x00-\x1f\x7f<>]/.test(region)
    && !/^(未知(?:地区|属地)?|暂无(?:数据|信息)?|无|--?|null|undefined)$/i.test(region) ? region : null;
}
export function replyRecord(reply) {
  if (!reply || typeof reply !== 'object') return null;
  const id = commentId(reply.rpid_str ?? reply.rpid);
  if (!id) return null;
  return {
    id, oid: commentId(reply.oid_str ?? reply.oid),
    location: commentRegion(reply.reply_control?.location),
    hasLocation: reply.reply_control != null && typeof reply.reply_control === 'object',
  };
}
export function cachedComment(cache, id, oid = null) {
  const record = cache.get(id);
  return record && (!oid || !record.oid || record.oid === oid) ? record.location : null;
}
export function collectComments(value, cache, limit = 5000) {
  const pending = [value], visited = new Set();
  let count = 0, changed = false;
  while (pending.length && count++ < 10000) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item);
    const record = replyRecord(item);
    if (record?.hasLocation) {
      const prior = cache.get(record.id);
      if (!prior || prior.location !== record.location || prior.oid !== record.oid) changed = true;
      cache.delete(record.id);
      cache.set(record.id, {id: record.id, oid: record.oid, location: record.location});
    }
    for (const key of ['data', 'replies', 'reply', 'root', 'top', 'top_replies', 'upper', 'admin', 'vote', 'hots']) {
      const child = item[key];
      if (child && typeof child === 'object') pending.push(child);
    }
    if (Array.isArray(item)) for (const child of item) if (child && typeof child === 'object') pending.push(child);
  }
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return changed;
}
export function isCommentRequest(input, base) {
  try {
    const url = new URL(input, base);
    return url.protocol === 'https:' && url.hostname === 'api.bilibili.com'
      && /^\/x\/v2\/reply(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}
