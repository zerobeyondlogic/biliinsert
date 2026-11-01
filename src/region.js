// Public IP-location fields can contain owner-only view counts and timestamps.
// Keep metadata parsing here so network results and older cached values agree.
const MAX_INPUT_LENGTH = 512;
const MAX_REGION_LENGTH = 64;
const MARKER_SOURCE = String.raw`\bIP\s*(?:归属地|属地)\s*[:：]?\s*`;
const NUMBER = String.raw`[0-9０-９]+(?:[.,，．][0-9０-９]+)*(?:\s*[万亿kKwW])?`;
const COUNT_KIND = String.raw`(?:浏览|阅读|观看|播放|转发|分享|点赞|评论|收藏|回复)(?:量|数)?`;
const META_SOURCE = [
  // Known counters in both orders; no province/country allowlist is involved.
  `${NUMBER}\\s*(?:次\\s*)?${COUNT_KIND}(?:\\s*次)?`,
  `${COUNT_KIND}\\s*[:：]?\\s*${NUMBER}(?:\\s*次)?`,
  String.raw`[0-9０-９]+(?:\.[0-9０-９]+)?\s*(?:秒|分钟|小时|天|周|个月|月|年)前`,
  String.raw`[0-9０-９]{4}[-/.年][0-9０-９]{1,2}[-/.月][0-9０-９]{1,2}日?`,
  String.raw`[0-9０-９]{1,2}[-/.月][0-9０-９]{1,2}日?`,
  String.raw`[0-9０-９]{1,2}[:：][0-9０-９]{2}(?:[:：][0-9０-９]{2})?`,
  String.raw`(?:刚刚|今天|昨天|前天|编辑于|修改于|发布于|更新于|已编辑|编辑过|仅自己可见|仅作者可见)`,
  String.raw`\b[0-9]+(?:[.,][0-9]+)*(?:[kKmMbB])?\s*(?:views?|reads?|plays?|likes?|comments?|reposts?)\b`,
  String.raw`\b[0-9]+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b`,
].join('|');
const EDGE_SEPARATORS = /^[\s|｜·•,，;；]+|[\s|｜·•,，;；]+$/gu;
const UNKNOWN = /^(?:未知(?:地区|属地)?|暂无(?:数据|信息)?|无|--?|null|undefined|unknown|n\/a)$/iu;
const NON_LOCATION = /(?:浏览|阅读|观看|播放|转发|分享|点赞|评论|收藏|回复|版权|转载|关注|工作室|编辑|发布|更新|属地)|\b(?:views?|reads?|plays?|likes?|comments?|reposts?|ago|yesterday|today|just now)\b/iu;

function trimSeparators(value) { return value.replace(EDGE_SEPARATORS, '').trim(); }
function plainRegion(value) {
  const region = trimSeparators(value);
  if (!region) return { region: null, reason: 'empty' };
  if (UNKNOWN.test(region)) return { region: null, reason: 'unknown' };
  if (region.length > MAX_REGION_LENGTH || NON_LOCATION.test(region)) return { region: null, reason: 'invalid' };
  // Letters from any script, diacritics and common geographical punctuation are
  // allowed. Digits, markup, URLs and colon-separated metadata are not names.
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’·・\-–—()（）,]*[\p{L}\p{M})）.]$/u.test(region)
      && !/^[\p{L}\p{M}]$/u.test(region)) return { region: null, reason: 'invalid' };
  if (region.includes(',') && /\p{Script=Han}/u.test(region)) return { region: null, reason: 'invalid' };
  let depth = 0;
  for (const char of region) {
    if ('(（'.includes(char)) depth++;
    else if (')）'.includes(char) && --depth < 0) return { region: null, reason: 'invalid' };
  }
  return depth === 0 ? { region, reason: null } : { region: null, reason: 'invalid' };
}

function markedSegment(value) {
  const segment = trimSeparators(value);
  if (!segment) return { region: null, reason: 'empty' };
  const metadata = new RegExp(META_SOURCE, 'giu');
  const first = metadata.exec(segment);
  if (!first) return plainRegion(segment);
  const trailing = segment.slice(first.index).replace(new RegExp(META_SOURCE, 'giu'), '');
  // A recognized counter is not permission to discard arbitrary trailing prose.
  if (trimSeparators(trailing)) return { region: null, reason: 'invalid' };
  return plainRegion(segment.slice(0, first.index));
}

/**
 * Parse a public region field; requireMarker is for general footer/copyright text.
 * A conflict is distinct from no data so one valid field cannot mask a conflict.
 */
export function parseRegion(value, { requireMarker = false } = {}) {
  const result = (region, reason, hasMarker = false) => ({ region, hasMarker, reason });
  if (typeof value !== 'string') return result(null, 'type');
  if (value.length > MAX_INPUT_LENGTH) return result(null, 'too-long');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]|\p{Cf}/u.test(value)) return result(null, 'invalid');
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!text) return result(null, 'empty');
  const markers = [...text.matchAll(new RegExp(MARKER_SOURCE, 'giu'))];
  if (!markers.length) {
    if (requireMarker) return result(null, 'missing-marker');
    // Without an explicit marker accept only a clean field, never a mixed caption.
    if (new RegExp(META_SOURCE, 'iu').test(text)) return result(null, 'invalid');
    const plain = plainRegion(text);
    return result(plain.region, plain.reason);
  }
  if (markers.length > 8) return result(null, 'invalid', true);
  const candidates = new Map();
  let unknown = false, invalid = false;
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + markers[i][0].length;
    const end = markers[i + 1]?.index ?? text.length;
    const parsed = markedSegment(text.slice(start, end));
    if (parsed.region) candidates.set(parsed.region.toLocaleLowerCase('en'), parsed.region);
    else if (parsed.reason === 'unknown') unknown = true;
    else if (parsed.reason !== 'empty') invalid = true;
  }
  if (candidates.size > 1) return result(null, 'conflict', true);
  if (invalid) return result(null, 'invalid', true);
  if (!candidates.size) return result(null, unknown ? 'unknown' : 'empty', true);
  return result(candidates.values().next().value, null, true);
}

/** Returns only the region, without an IP label, counters or timestamps. */
export function normalizeRegion(value, options) { return parseRegion(value, options).region; }
