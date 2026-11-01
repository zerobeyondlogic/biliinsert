// Adapted from Chihiro521/bili-ip-region (MIT), protocol.ts, commit b1ede0b29c4612eacfa0ad5b864237d821d5cd02.
// Copyright (c) 2026 Chihiro521. See licenses/bili-ip-region-MIT.txt.
// Decode only the requested post's top-level author/footer, never its forwarded content.
import { normalizeRegion, parseRegion } from './region.js';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_BYTES = 16 * 1024 * 1024;

export function normalizeDynamicRegion(value) {
  return normalizeRegion(value);
}

export function validateDynamicId(id) {
  if (typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 0x7fffffffffffffffn) {
    throw new Error('动态 ID 必须是正 int64 字符串');
  }
  return id;
}

export function concat(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export function varint(value) {
  if (typeof value !== 'bigint' || value < 0n || value > 0xffffffffffffffffn) throw new Error('protobuf 整数无效');
  const bytes = [];
  do { const byte = Number(value & 127n); value >>= 7n; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Uint8Array.from(bytes);
}
export function intField(number, value) { return concat(varint(BigInt(number * 8)), varint(value)); }
export function bytesField(number, value) { return concat(varint(BigInt(number * 8 + 2)), varint(BigInt(value.length)), value); }
export function stringField(number, value) { return bytesField(number, encoder.encode(value)); }
export function grpcFrame(message) {
  const header = new Uint8Array(5);
  new DataView(header.buffer).setUint32(1, message.length);
  return concat(header, message);
}

function fields(input) {
  if (input.length > MAX_BYTES) throw new Error('响应过大');
  let offset = 0;
  const result = [];
  function readVarint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= input.length) throw new Error('protobuf 整数被截断');
      const byte = input[offset++];
      if (i === 9 && byte > 1) throw new Error('protobuf 整数过大');
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value;
    }
    throw new Error('protobuf 整数过长');
  }
  while (offset < input.length) {
    const tag = readVarint(), number = Number(tag >> 3n), wire = Number(tag & 7n);
    if (!number || number > 536870911) throw new Error('protobuf 字段编号无效');
    const field = { number, wire };
    if (wire === 0) field.integer = readVarint();
    else if (wire === 2) {
      const size = readVarint();
      if (size > BigInt(input.length - offset)) throw new Error('protobuf 字段被截断');
      field.bytes = input.subarray(offset, offset + Number(size)); offset += Number(size);
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > input.length) throw new Error('protobuf 固定长度字段被截断');
    } else throw new Error('不支持的 protobuf 字段类型');
    result.push(field);
  }
  return result;
}
function bytesAt(list, number) { return list.find(field => field.number === number && field.wire === 2)?.bytes; }
function intAt(list, number) { return list.find(field => field.number === number && field.wire === 0)?.integer; }
function textAt(list, number) { const bytes = bytesAt(list, number); return bytes ? decoder.decode(bytes) : null; }

export function requestBody(method, id) {
  validateDynamicId(id);
  if (!['DynDetail', 'OpusDetail'].includes(method)) throw new Error('动态查询方法无效');
  const identity = method === 'DynDetail' ? stringField(2, id) : intField(2, BigInt(id));
  return grpcFrame(concat(identity, intField(10, 8n)));
}

export function decodeDynamicResponse(method, frame) {
  if (!['DynDetail', 'OpusDetail'].includes(method)) throw new Error('动态查询方法无效');
  if (frame.length < 5 || frame.length > MAX_BYTES) throw new Error('gRPC 响应长度无效');
  if (frame[0] !== 0) throw new Error('gRPC 响应使用了不支持的压缩');
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1);
  if (length > MAX_BYTES || length + 5 > frame.length) throw new Error('gRPC 消息被截断');
  const itemBytes = bytesAt(fields(frame.subarray(5, length + 5)), 1);
  if (!itemBytes) throw new Error('响应缺少动态主体');
  const item = fields(itemBytes);
  const opus = method === 'OpusDetail';
  const extend = bytesAt(item, opus ? 5 : 4);
  const extendedId = extend ? textAt(fields(extend), 1) : null;
  const opusId = opus ? intAt(item, 1)?.toString() : null;
  if (extendedId && opusId && extendedId !== opusId) throw new Error('Opus ID 与动态 ID 不一致');
  const returnedId = extendedId || opusId;
  let authorMid = null;
  const regions = new Map();
  let source = null;
  for (const module of item.filter(field => field.number === (opus ? 4 : 3) && field.wire === 2)) {
    const list = fields(module.bytes);
    const authorBytes = bytesAt(list, 2);
    if (authorBytes) {
      const author = fields(authorBytes);
      const mid = intAt(author, 1)?.toString() ?? null;
      if (authorMid && mid && authorMid !== mid) throw new Error('动态作者字段不一致');
      authorMid = authorMid || mid;
      const parsed = parseRegion(textAt(author, 14));
      if (parsed.reason === 'conflict') throw new Error('同一动态的属地来源不一致');
      if (parsed.region) { regions.set(parsed.region.toLocaleLowerCase('en'), parsed.region); source = 'author'; }
    }
    const footer = bytesAt(list, 31);
    if (footer) for (const caption of fields(footer).filter(field => [1, 2].includes(field.number) && field.wire === 2)) {
      const text = decoder.decode(caption.bytes);
      // The owner's caption may start with view counts. General footer text is
      // accepted only when an explicit IP-location marker identifies the region.
      const parsed = parseRegion(text, { requireMarker: true });
      if (parsed.reason === 'conflict') throw new Error('同一动态的属地来源不一致');
      if (parsed.region) { regions.set(parsed.region.toLocaleLowerCase('en'), parsed.region); source = 'copyright'; }
    }
  }
  if (regions.size > 1) throw new Error('同一动态的属地来源不一致');
  return { returnedId, authorMid, region: regions.values().next().value ?? null, locationSource: source };
}
