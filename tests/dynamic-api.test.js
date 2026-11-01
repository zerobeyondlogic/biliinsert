import test from 'node:test';
import assert from 'node:assert/strict';
import { queryDynamic } from '../src/dynamic-api.js';
import { bytesField, concat, decodeDynamicResponse, grpcFrame, intField, stringField, requestBody } from '../src/dynamic-protocol.js';

const id = '1245177092906156001';
const token = 'fixture-only-access-token';
function frame(method, { region = 'IP属地：上海', mid = '10', returnedId = id, footer, forwardedRegion } = {}) {
  const author = concat(intField(1, BigInt(mid)), ...(region === null ? [] : [stringField(14, region)]));
  const modules = [bytesField(2, author)];
  if (footer) modules.push(bytesField(31, stringField(1, footer)));
  if (forwardedRegion) modules.push(bytesField(4, bytesField(2, stringField(14, forwardedRegion))));
  return grpcFrame(bytesField(1, concat(...(method === 'OpusDetail' ? [intField(1, BigInt(returnedId))] : []),
    ...modules.map(module => bytesField(method === 'DynDetail' ? 3 : 4, module)),
    bytesField(method === 'DynDetail' ? 4 : 5, stringField(1, returnedId)))));
}
function options(fetchImpl, expectedMid = '10') { return { expectedMid, deviceId: 'fixture-device-id', fetchImpl }; }

test('keeps large dynamic IDs lossless and rejects unsafe numeric inputs', () => {
  assert.throws(() => requestBody('DynDetail', Number(id)));
  assert.throws(() => requestBody('DynDetail', '9223372036854775808'));
  assert.equal(decodeDynamicResponse('DynDetail', frame('DynDetail')).returnedId, id);
});
test('uses app authorization, no web cookies, and returns only a verified region', async () => {
  const result = await queryDynamic(id, token, options(async (url, init) => {
    assert.equal(url, 'https://app.bilibili.com/bilibili.app.dynamic.v2.Dynamic/DynDetail');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.authorization, `identify_v1 ${token}`);
    return new Response(frame('DynDetail'), { headers: { 'grpc-status': '0' } });
  }));
  assert.equal(result.status, 'ok'); assert.equal(result.region, '上海'); assert.equal(result.authorMid, '10');
  assert.equal(JSON.stringify(result).includes(token), false);
});
test('queries Opus when author location is missing and accepts only explicit IP footer text', async () => {
  const calls = [];
  const result = await queryDynamic(id, token, options(async url => {
    const method = url.split('/').at(-1); calls.push(method);
    return new Response(frame(method, { region: null, footer: method === 'OpusDetail' ? 'IP属地：广东' : '未经许可禁止转载' }));
  }));
  assert.equal(result.region, '广东'); assert.deepEqual(calls, ['DynDetail', 'OpusDetail']);
});
test('own dynamic author metadata extracts the same region as the public-view field', async () => {
  for (const raw of ['上海', 'IP属地：上海', '215浏览 IP属地：上海', '215浏览\u00a0IP属地：上海',
    '215浏览\u3000·\u3000IP属地：上海', 'IP属地：215浏览 IP属地：上海']) {
    const result = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), { region: raw }))));
    assert.equal(result.status, 'ok', raw); assert.equal(result.region, '上海', raw);
  }
});
test('owner-only counters before a footer marker are accepted and agree with the author', async () => {
  for (const region of [null, '上海', '215浏览 IP属地：上海']) {
    const result = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), {
      region, footer: '215浏览 · IP属地：上海',
    }))));
    assert.equal(result.status, 'ok'); assert.equal(result.region, '上海');
  }
  const unmarked = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), {
    region: null, footer: '上海',
  }))));
  assert.equal(unmarked.status, 'empty');
  const sameInternational = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), {
    region: 'United States', footer: '215 views · IP属地：United States',
  }))));
  assert.equal(sameInternational.status, 'ok'); assert.equal(sameInternational.region, 'United States');
});
test('mixed or repeated conflicting regions cannot be hidden by a valid field', async () => {
  for (const fixture of [
    {region:'215浏览 IP属地：上海', footer:'IP属地：北京'},
    {region:'IP属地：上海 IP属地：北京', footer:'IP属地：上海'},
    {region:'上海', footer:'215浏览 IP属地：上海 IP属地：北京'},
  ]) {
    const result = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), fixture))));
    assert.equal(result.status, 'error'); assert.equal(result.region, null);
  }
  const statsOnly = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), {
    region:'215浏览', footer:'215阅读', forwardedRegion:'IP属地：广东',
  }))));
  assert.equal(statsOnly.status, 'empty'); assert.equal(statsOnly.region, null);
});
test('never borrows forwarded post or profile regions when the post has no region', async () => {
  const result = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), {
    region: null, forwardedRegion: 'IP属地：浙江', footer: '上海工作室 版权所有',
  }))));
  assert.equal(result.status, 'empty'); assert.equal(result.region, null);
});
test('rejects mismatched IDs, authors, and conflicting region sources', async () => {
  for (const fixture of [{ returnedId: '1245177092906156002' }, { mid: '20' }, { footer: 'IP属地：北京' }]) {
    const result = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), fixture))));
    assert.equal(result.status, 'error'); assert.equal(result.region, null);
  }
});
test('auth required does not send unauthenticated requests; revoked authorization is distinguished', async () => {
  assert.equal((await queryDynamic(id, '', options(() => assert.fail('request sent')))).status, 'auth-required');
  assert.equal((await queryDynamic(id, token, options(async () => new Response(null, { headers: { 'grpc-status': '16' } })))).status, 'auth-required');
});
test('Bilibili auth errors and missing-content errors are distinguished', async () => {
  for (const code of ['-101', '-2', '%2D101']) {
    const result = await queryDynamic(id, token, options(async () => new Response(null, { headers: { 'grpc-status': '2', 'grpc-message': code } })));
    assert.equal(result.status, 'auth-required'); assert.equal(result.reason, 'auth');
  }
  const missing = await queryDynamic(id, token, options(async () => new Response(null, { headers: { 'grpc-status': '2', 'grpc-message': '4101105' } })));
  assert.equal(missing.status, 'error'); assert.equal(missing.reason, 'api'); assert.match(missing.error, /4101105/);
});
test('rate limits stop fallback requests immediately', async () => {
  for (const [status, grpc] of [[412, ''], [429, ''], [200, '8']]) {
    let count = 0;
    const limited = await queryDynamic(id, token, options(async () => { count++; return new Response(null, { status, headers: { 'grpc-status': grpc } }); }));
    assert.equal(limited.status, 'error'); assert.equal(limited.reason, 'rate'); assert.equal(count, 1);
  }
});
test('a failed fallback never turns partial results into a verified empty region', async () => {
  const result = await queryDynamic(id, token, options(async url => {
    if (url.endsWith('/OpusDetail')) throw new Error('offline');
    return new Response(frame('DynDetail', { region: null }));
  }));
  assert.equal(result.status, 'error'); assert.equal(result.reason, 'network'); assert.equal(result.region, null);
});
test('malformed, compressed, truncated and oversized protobuf frames fail safely', () => {
  for (const bad of [new Uint8Array(), Uint8Array.of(1, 0, 0, 0, 0), Uint8Array.of(0, 0, 0, 1, 0),
    grpcFrame(Uint8Array.of(10, 255, 255, 255, 255, 15)), grpcFrame(Uint8Array.of(0)),
    new Uint8Array(16 * 1024 * 1024 + 1)]) assert.throws(() => decodeDynamicResponse('DynDetail', bad));
});
test('unknown locations and network failures never manufacture a region', async () => {
  const unknown = await queryDynamic(id, token, options(async url => new Response(frame(url.split('/').at(-1), { region: 'IP属地：未知' }))));
  assert.equal(unknown.status, 'empty');
  const failed = await queryDynamic(id, token, options(async () => { throw new Error(token); }));
  assert.equal(failed.status, 'error'); assert.equal(failed.region, null); assert.equal(JSON.stringify(failed).includes(token), false);
});
