import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError, createApi, locationText, parseCredential, parseProfile, requestSignal, signQuery } from '../src/api.js';
import { createBackground, senderAccess } from '../src/background.js';

const NOW = 1800000000000;
const AUTH_CODE = 'test-auth-code-1234567890';
const TOKEN = 'fixture-token-never-a-real-credential';
const DEVICE = 'XXTESTDEVICE123456789';
const credential = { accessToken: TOKEN, deviceId: DEVICE, expiresAt: NOW + 3600000 };
const runtimeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const extension = { id: runtimeId, url: `chrome-extension://${runtimeId}/popup.html` };
const page = { id: runtimeId, url: 'https://space.bilibili.com/123', frameId: 0 };
const qr = { ok: true, authCode: AUTH_CODE, url: `https://passport.bilibili.com/x/passport-tv-login/h5/qrcode/auth?auth_code=${AUTH_CODE}`, expiresAt: NOW + 180000 };
const response = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });

function fakeChrome(initial = {}) {
  const values = { local: { ...initial }, session: {} };
  const restrictions = [];
  const rules = [];
  const sessionRules = [];
  const messages = [];
  const tabQueries = [];
  const area = name => ({
    async get(key) { return { [key]: values[name][key] }; },
    async set(data) { Object.assign(values[name], data); },
    async remove(key) { for (const k of Array.isArray(key) ? key : [key]) delete values[name][k]; },
    async setAccessLevel(level) { restrictions.push([name, level.accessLevel]); },
  });
  return {
    values, restrictions, rules, sessionRules, messages, tabQueries, runtime: { id: runtimeId },
    storage: { local: area('local'), session: area('session') },
    declarativeNetRequest: { async updateDynamicRules(value) { rules.push(value); }, async updateSessionRules(value) { sessionRules.push(value); } },
    tabs: { async query(options) { tabQueries.push(options); return [{ id: 1 }]; }, async sendMessage(id, message) { messages.push(message); } },
  };
}

function mockBackground(initial, api, extra = {}) {
  const chrome = fakeChrome(initial);
  const background = createBackground(chrome, { apiFactory: () => api, now: () => NOW, pause: async () => {}, ...extra });
  return { chrome, background };
}

test('APP signing sorts and URL encodes parameters, using separate login key', () => {
  const signed = signQuery({ z: '空 格', a: '1' }, true, 123);
  const base = 'a=1&ts=123&z=%E7%A9%BA+%E6%A0%BC';
  assert.equal(signed, `${base}&sign=${createHash('md5').update(base + '2653583c8873dea268ab9386918b1d65').digest('hex')}`);
  assert.notEqual(signed, signQuery({ z: '空 格', a: '1' }, false, 123));
});

test('profile uses server location tags only, including bottom tags', () => {
  assert.equal(parseProfile({ code: 0, data: { card: { mid: 123, place: '用户自填', space_tag: [{ type: 'school', title: '北京' }], space_tag_bottom: [{ type: 'location', title: 'IP属地：广东' }] } } }, '123').location, 'IP属地：广东');
  assert.equal(parseProfile({ code: 0, data: { card: { mid: 123, place: '上海', space_tag: [] } } }, '123').location, null);
  assert.throws(() => parseProfile({ code: 0, data: { card: { mid: 124, space_tag: [{ type: 'location', title: '北京' }] } } }, '123'), /不匹配/);
  assert.throws(() => parseProfile({ code: 0, data: { card: { space_tag: [{ type: 'location', title: '北京' }] } } }, '123'), /不匹配/);
  assert.throws(() => parseProfile({ code: -101 }, '123'), error => error.reason === 'auth');
});

test('display formatting extracts own-post location and never prefixes view counts', () => {
  assert.equal(locationText('215浏览 IP属地：上海'), 'IP属地：上海');
  assert.equal(locationText('IP属地：215浏览 IP属地：上海'), 'IP属地：上海');
  assert.equal(locationText('215浏览'), null);
  assert.equal(locationText('IP属地：上海 IP属地：北京'), null);
});

test('profile API never treats lack of authorization as empty and sends no browser cookies', async () => {
  const calls = [];
  const api = createApi(DEVICE, { now: () => NOW, fetchImpl: async (...args) => { calls.push(args); return response({ code: 0, data: { card: { mid: 123, space_tag: [] } } }); } });
  await assert.rejects(api.profile('123', ''), error => error.reason === 'auth');
  assert.equal(calls.length, 0);
  assert.equal((await api.profile('123', TOKEN)).location, null);
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(new URL(calls[0][0]).searchParams.get('vmid'), '123');
});

test('QR protocol accepts only bound official URLs, and handles pending/scanned/expired', async () => {
  const json = { code: 0, data: { url: qr.url, auth_code: AUTH_CODE } };
  let reply = json;
  const api = createApi(DEVICE, { now: () => NOW, fetchImpl: async () => response(reply) });
  assert.deepEqual(await api.startAuth(), qr);
  reply = { code: 0, data: { url: 'https://example.com/?auth_code=' + AUTH_CODE, auth_code: AUTH_CODE } };
  await assert.rejects(api.startAuth(), /二维码响应无效/);
  for (const [code, status] of [[86039, 'pending'], [86090, 'scanned'], [86038, 'expired']]) {
    reply = { code };
    assert.equal((await api.pollAuth(AUTH_CODE)).status, status);
  }
});

test('credential decoding does not retain cookies or refresh tokens', () => {
  const parsed = parseCredential({ token_info: { access_token: TOKEN, expires_in: 3600, refresh_token: 'do-not-store' }, cookie_info: { cookies: ['do-not-store'] } }, DEVICE, NOW);
  assert.deepEqual(parsed, credential);
  assert.throws(() => parseCredential({ access_token: TOKEN }, DEVICE, NOW), /期限/);
  assert.equal(parseCredential({ mid: 123, token_info: { access_token: TOKEN, expires_in: 3600 } }, DEVICE, NOW).ownerMid, '123');
  assert.throws(() => parseCredential({ mid: 123, token_info: { mid: 456, access_token: TOKEN, expires_in: 3600 } }, DEVICE, NOW), /账号不一致/);
});

test('request cancellation works without AbortSignal.any', () => {
  const controller = new AbortController();
  const signal = requestSignal(controller.signal);
  assert.equal(signal.aborted, false);
  controller.abort();
  assert.equal(signal.aborted, true);
  assert.equal(requestSignal(controller.signal).aborted, true);
});

test('API no longer exposes Web Cookie conversion or a confirmation request', () => {
  const api = createApi(DEVICE, { fetchImpl: async () => { assert.fail('No request may be sent'); } });
  assert.equal(api.confirmWebAuth, undefined);
  assert.deepEqual(Object.keys(api).sort(), ['pollAuth', 'profile', 'startAuth']);
});

test('API distinguishes network, HTTP and Bilibili throttling errors', async () => {
  for (const [fetchImpl, reason] of [
    [async () => { throw new Error(TOKEN); }, 'network'],
    [async () => response({}, 401), 'auth'],
    [async () => response({}, 429), 'rate'],
    [async () => response({ code: -352 }), 'rate'],
  ]) {
    const api = createApi(DEVICE, { fetchImpl });
    await assert.rejects(api.profile('123', TOKEN), error => error.reason === reason && !error.message.includes(TOKEN));
  }
});

test('sender validation rejects foreign, subframe, HTTP and forged suffix origins', () => {
  assert.equal(senderAccess(extension, runtimeId), 'extension');
  assert.equal(senderAccess(page, runtimeId), 'page');
  for (const sender of [{ ...page, id: 'foreign' }, { ...page, frameId: 2 }, { ...page, url: 'http://space.bilibili.com/123' }, { ...page, url: 'https://space.bilibili.com.attacker.example/123' }, { ...page, url: 'https://example.com' }]) assert.equal(senderAccess(sender, runtimeId), null);
});

test('background limits auth management to extension pages and locks storage before use', async () => {
  const { chrome, background } = mockBackground({}, {});
  assert.equal((await background.handle({ type: 'AUTH_START' }, page)).ok, false);
  assert.equal((await background.handle({ type: 'AUTH_STATUS' }, page)).ok, false);
  assert.deepEqual(await background.handle({ type: 'AUTH_STATUS' }, extension), { ok: true, authorized: false });
  assert.deepEqual(chrome.restrictions, [['local', 'TRUSTED_CONTEXTS'], ['session', 'TRUSTED_CONTEXTS']]);
  assert(chrome.rules[0].addRules.every(rule => rule.condition.initiatorDomains[0] === runtimeId));
  assert.equal((await background.handle({ type: 'GET_PROFILE', mid: '123' }, page)).reason, 'auth');
});

test('background deduplicates profile reads and caches them, preserving mid identity', async () => {
  let count = 0;
  const { background } = mockBackground({ biliIpCredential: credential }, { async profile(mid) { count++; return { ok: true, mid, location: 'IP属地：上海' }; } });
  const results = await Promise.all([1, 2, 3].map(() => background.handle({ type: 'GET_PROFILE', mid: '123' }, page)));
  assert.equal(count, 1);
  assert(results.every(result => result.mid === '123'));
  await background.handle({ type: 'GET_PROFILE', mid: '123' }, page);
  assert.equal(count, 1);
});

test('dynamic accepts absent expectedMid and checks returned identity when supplied', async () => {
  const { background } = mockBackground({ biliIpCredential: credential }, {}, {
    dynamicQuery: async id => ({ id, authorMid: '456', status: 'ok', region: '广东' }),
  });
  const value = await background.handle({ type: 'GET_DYNAMIC', id: '1234567890123456789', expectedMid: null }, page);
  assert.equal(value.ok, true);
  assert.equal(value.authorMid, '456');
  assert.equal(value.location, 'IP属地：广东');
  assert.equal((await background.handle({ type: 'GET_DYNAMIC', id: '1234567890123456789', expectedMid: '789' }, page)).ok, false);
});

test('successful QR poll stores credentials without returning them', async () => {
  const { chrome, background } = mockBackground({}, { async startAuth() { return qr; }, async pollAuth() { return { ok: true, status: 'authorized', credential }; } });
  await background.handle({ type: 'AUTH_START' }, extension);
  const result = await background.handle({ type: 'AUTH_POLL', authCode: AUTH_CODE }, extension);
  assert.deepEqual(result, { ok: true, status: 'authorized' });
  assert(!JSON.stringify(result).includes(TOKEN));
  assert.deepEqual(chrome.values.local.biliIpCredential, credential);
  assert.deepEqual(chrome.messages, [{ type: 'AUTH_CHANGED' }]);
  assert.deepEqual(chrome.tabQueries, [{}]);
  assert.equal((await background.handle({ type: 'AUTH_STATUS' }, extension)).authorized, true);
});

test('clearing during an in-flight poll prevents credentials from being resurrected', async () => {
  let finishPoll;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const { chrome, background } = mockBackground({}, { async startAuth() { return qr; }, async pollAuth() { signalStarted(); return new Promise(resolve => { finishPoll = resolve; }); } });
  await background.handle({ type: 'AUTH_START' }, extension);
  const pending = background.handle({ type: 'AUTH_POLL', authCode: AUTH_CODE }, extension);
  await started;
  await background.handle({ type: 'AUTH_CLEAR' }, extension);
  finishPoll({ ok: true, status: 'authorized', credential });
  assert.equal((await pending).status, 'expired');
  assert.equal(chrome.values.local.biliIpCredential, undefined);
  assert.equal((await background.handle({ type: 'AUTH_STATUS' }, extension)).authorized, false);
});

test('clearing during an in-flight lookup discards stale region results', async () => {
  let finish;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const { background } = mockBackground({ biliIpCredential: credential }, { async profile() { signalStarted(); return new Promise(resolve => { finish = resolve; }); } });
  const pending = background.handle({ type: 'GET_PROFILE', mid: '123' }, page);
  await started;
  await background.handle({ type: 'AUTH_CLEAR' }, extension);
  finish({ ok: true, mid: '123', location: 'IP属地：北京' });
  assert.equal((await pending).reason, 'auth');
  assert.equal((await background.handle({ type: 'GET_PROFILE', mid: '123' }, page)).reason, 'auth');
});

test('a rate-limit response pauses further network queries without returning empty', async () => {
  let calls = 0;
  const { background } = mockBackground({ biliIpCredential: credential }, { async profile() { calls++; throw new ApiError('请稍后重试', 'rate'); } });
  assert.equal((await background.handle({ type: 'GET_PROFILE', mid: '123' }, page)).reason, 'rate');
  assert.equal((await background.handle({ type: 'GET_PROFILE', mid: '456' }, page)).reason, 'rate');
  assert.equal(calls, 1);
});

test('retired Web authorization messages never access Cookies or send requests', async () => {
  const chrome = fakeChrome({ biliIpCredential: credential });
  let cookieAccesses = 0, apiClients = 0;
  Object.defineProperty(chrome, 'cookies', { get() { cookieAccesses++; throw new Error('Cookie access is forbidden'); } });
  const background = createBackground(chrome, { now: () => NOW, apiFactory() { apiClients++; throw new Error('No API client may be created'); } });
  assert.equal((await background.handle({ type: 'AUTH_WEB_START', tabId: 7 }, page)).ok, false);
  const result = await background.handle({ type: 'AUTH_WEB_START', tabId: 7 }, extension);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unavailable');
  assert.match(result.error, /已停用/);
  assert.equal(cookieAccesses, 0);
  assert.equal(apiClients, 0);
  assert.deepEqual(chrome.values.local.biliIpCredential, credential);
  assert.equal((await background.handle({ type: 'AUTH_STATUS' }, extension)).authorized, true);
});

test('startup removes historical Cookie rules without changing existing App credentials', async () => {
  const priorCredential = { ...credential, ownerMid: '123', source: 'web' };
  const { chrome, background } = mockBackground({ biliIpCredential: priorCredential }, {});
  await background.ready;
  assert.deepEqual(chrome.sessionRules, [{ removeRuleIds: [100, 101] }]);
  assert.deepEqual(chrome.values.local.biliIpCredential, priorCredential);
  assert.equal((await background.handle({ type: 'AUTH_STATUS' }, extension)).authorized, true);
  assert(chrome.rules[0].addRules.every(rule => !rule.action.requestHeaders.some(header => header.header === 'cookie')));
});

test('a retired Web request does not interrupt an active QR authorization', async () => {
  const { background, chrome } = mockBackground({}, { async startAuth() { return qr; }, async pollAuth() { return { ok: true, status: 'authorized', credential }; } });
  await background.handle({ type: 'AUTH_START' }, extension);
  assert.equal((await background.handle({ type: 'AUTH_WEB_START', tabId: 7 }, extension)).reason, 'unavailable');
  assert.equal((await background.handle({ type: 'AUTH_POLL', authCode: AUTH_CODE }, extension)).status, 'authorized');
  assert.deepEqual(chrome.values.local.biliIpCredential, credential);
});
