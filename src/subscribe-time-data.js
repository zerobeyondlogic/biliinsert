// Independently implemented from the documented feature/API behavior of
// Bilibili-Evolved's subscribeTimeShow. No upstream implementation is copied.
export const SUBSCRIBE_CHANNEL = 'brp:subscribe-time:v1';
export const SUBSCRIBE_LABEL = '[data-brp-subscribe-time]';

export function userId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : null;
}

export function spaceContext(href) {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.hostname !== 'space.bilibili.com') return null;
    const match = url.pathname.match(/^\/([1-9]\d*)(?:\/(?:relation|fans)\/(follow|fans)(?:\/|$)|\/|$)/);
    if (!match) return null;
    const owner = userId(match[1]);
    return owner ? { owner, section: match[2] === 'follow' ? 'followings' : match[2] === 'fans' ? 'fans' : null } : null;
  } catch { return null; }
}

export function relationRequest(input, base = 'https://space.bilibili.com/') {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, base);
    if (url.protocol !== 'https:' || url.hostname !== 'api.bilibili.com') return null;
    if (url.pathname === '/x/web-interface/nav') return { kind: 'viewer' };
    if (['/x/relation/modify', '/x/relation/batch/modify'].includes(url.pathname)) return { kind: 'mutation' };
    if (['/x/web-interface/relation', '/x/space/wbi/acc/relation', '/x/space/acc/relation'].includes(url.pathname)) {
      const target = userId(url.searchParams.get('mid'));
      return target ? { kind: 'profile', target } : null;
    }
    const section = ['/x/relation/followings', '/x/relation/followings/search'].includes(url.pathname) ? 'followings'
      : ['/x/relation/fans', '/x/relation/followers'].includes(url.pathname) ? 'fans' : null;
    const owner = userId(url.searchParams.get('vmid'));
    return section && owner ? { kind: 'list', section, owner } : null;
  } catch { return null; }
}

export function followTimestamp(value, now = Date.now()) {
  // Reject absent, malformed, millisecond-valued and future timestamps.
  return Number.isInteger(value) && value >= 1245945600 && value <= Math.floor(now / 1000) + 300 ? value : null;
}

export function viewerFromResponse(body) {
  return body?.code === 0 && body.data?.isLogin === true ? userId(body.data.mid) : null;
}

export function profileFollowTime(body, target, viewer, now = Date.now()) {
  target = userId(target); viewer = userId(viewer);
  if (!target || !viewer || target === viewer || body?.code !== 0) return null;
  const relation = body.data?.relation;
  // Follow the original feature's conservative rule. Mutual-follow / blocked /
  // unknown relationship changes must not be mislabeled as a follow timestamp.
  if (userId(relation?.mid) !== target || relation.attribute !== 2) return null;
  const reverseMid = userId(body.data?.be_relation?.mid);
  if (reverseMid && reverseMid !== viewer) return null;
  return followTimestamp(relation.mtime, now);
}

export function listFollowTimes(request, body, now = Date.now()) {
  if (request?.kind !== 'list' || !userId(request.owner) || !['followings', 'fans'].includes(request.section)
      || body?.code !== 0 || !Array.isArray(body.data?.list)) return [];
  return body.data.list.slice(0, 200).flatMap(row => {
    const mid = userId(row?.mid), time = followTimestamp(row?.mtime, now);
    return mid && time ? [{ owner: request.owner, section: request.section, mid, time }] : [];
  });
}

export function relationKey(owner, section, mid) { return `${owner}:${section}:${mid}`; }

export function listTimeCaption(owner, section, viewer) {
  const own = userId(owner) && userId(owner) === userId(viewer);
  if (section === 'followings') return own ? '你关注 Ta 于' : '主页主人关注 Ta 于';
  return own ? 'Ta 关注你于' : 'Ta 关注主页主人于';
}

export function formatFollowTime(seconds) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(seconds * 1000));
}
