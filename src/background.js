import { ApiError, createApi, locationText, PROFILE_UA, validId } from './api.js';
import { queryDynamic, MOBILE_UA } from './dynamic-api.js';

const KNOWN_TYPES = new Set(['GET_PROFILE', 'GET_DYNAMIC', 'AUTH_START', 'AUTH_POLL', 'AUTH_CLEAR', 'AUTH_STATUS', 'AUTH_WEB_START']);
const PAGE_HOSTS = new Set(['www.bilibili.com', 'space.bilibili.com', 't.bilibili.com']);
const CREDENTIAL_KEY = 'biliIpCredential';
const DEVICE_KEY = 'biliIpDevice';
const PENDING_KEY = 'biliIpPendingAuth';

export function senderAccess(sender, runtimeId) {
  if (sender?.id !== runtimeId) return null;
  try {
    const url = new URL(sender.url);
    if (url.protocol === 'chrome-extension:' && url.hostname === runtimeId) return 'extension';
    if (url.protocol === 'https:' && PAGE_HOSTS.has(url.hostname) && (sender.frameId === undefined || sender.frameId === 0)) return 'page';
  } catch { /* Reject missing and malformed sender URLs. */ }
  return null;
}

export function createBackground(chromeApi, { apiFactory = createApi, dynamicQuery = queryDynamic, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let generation = 0;
  let clientTask;
  let startTask;
  let pollTask;
  let nextPoll = 0;
  let previousPoll = { ok: true, status: 'pending' };
  let authMutation = Promise.resolve();
  const mutateAuth = operation => {
    const task = authMutation.then(operation);
    authMutation = task.catch(() => {});
    return task;
  };
  const cache = new Map();
  const pending = new Map();
  let cooldownUntil = 0;
  let running = 0;
  let nextStart = 0;
  const queue = [];

  // Finish storage isolation and request-header rules before any API call.
  const ready = Promise.all([
    // Remove Cookie-carrying session rules left by versions 0.2.0–0.2.1.
    // Existing App credentials remain valid and are deliberately retained.
    chromeApi.declarativeNetRequest.updateSessionRules({ removeRuleIds: [100, 101] }),
    chromeApi.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chromeApi.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chromeApi.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2], addRules: [
      { id: 1, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'user-agent', operation: 'set', value: PROFILE_UA },
        { header: 'origin', operation: 'remove' },
      ] }, condition: { regexFilter: '^https://(app\\.bilibili\\.com/x/v2/space(?:\\?|$)|passport\\.bilibili\\.com/x/passport-tv-login/qrcode/)', initiatorDomains: [chromeApi.runtime.id], resourceTypes: ['xmlhttprequest'] } },
      { id: 2, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'user-agent', operation: 'set', value: MOBILE_UA },
        { header: 'origin', operation: 'remove' },
      ] }, condition: { regexFilter: '^https://app\\.bilibili\\.com/bilibili\\.app\\.dynamic\\.v2\\.(Dynamic/DynDetail|Opus/OpusDetail)$', initiatorDomains: [chromeApi.runtime.id], resourceTypes: ['xmlhttprequest'] } },
    ] }),
  ]);
  // Keep an initialization failure observable to requests without an unhandled rejection.
  ready.catch(() => {});

  async function client() {
    await ready;
    if (!clientTask) clientTask = (async () => {
      const stored = await chromeApi.storage.local.get(DEVICE_KEY);
      const deviceId = typeof stored[DEVICE_KEY] === 'string' ? stored[DEVICE_KEY] : `XX${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
      if (deviceId !== stored[DEVICE_KEY]) await chromeApi.storage.local.set({ [DEVICE_KEY]: deviceId });
      return { api: apiFactory(deviceId), deviceId };
    })().catch(error => { clientTask = null; throw error; });
    return clientTask;
  }

  async function credential() {
    const value = (await chromeApi.storage.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
    return value && typeof value.accessToken === 'string' && typeof value.deviceId === 'string' && Number.isFinite(value.expiresAt) && value.expiresAt > now() + 60000 ? value : null;
  }

  async function announce() {
    // URL-filtered queries need page host permissions. We only need tab IDs;
    // tabs without this extension's content script simply reject sendMessage.
    const tabs = await chromeApi.tabs.query({});
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chromeApi.tabs.sendMessage(tab.id, { type: 'AUTH_CHANGED' }, { frameId: 0 })));
  }

  async function clearAuth() {
    generation++;
    cache.clear();
    nextPoll = 0;
    await mutateAuth(() => Promise.all([chromeApi.storage.local.remove(CREDENTIAL_KEY), chromeApi.storage.session.remove(PENDING_KEY)]));
    await announce();
    return { ok: true, authorized: false };
  }

  function pump() {
    while (running < 2 && queue.length) {
      const job = queue.shift();
      running++;
      const delay = Math.max(0, nextStart - now());
      nextStart = Math.max(now(), nextStart) + 450;
      (async () => { if (delay) await pause(delay); if (now() < cooldownUntil) throw new ApiError('B站暂时限制了请求，请稍后重试', 'rate'); return job.run(); })()
        .then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  }

  function schedule(run) {
    if (queue.length >= 60) throw new ApiError('等待查询的动态较多，请稍后再试', 'rate');
    return new Promise((resolve, reject) => { queue.push({ run, resolve, reject }); pump(); });
  }

  function failure(error) {
    return { ok: false, error: error instanceof ApiError ? error.message : '查询暂不可用，请稍后重试', reason: error instanceof ApiError ? error.reason : 'api' };
  }

  async function lookup(message) {
    const profile = message.type === 'GET_PROFILE';
    const id = profile ? message.mid : message.id;
    if (!validId(id) || (message.expectedMid != null && !validId(message.expectedMid))) throw new ApiError('查询编号无效');
    const auth = await credential();
    if (!auth) throw new ApiError('请先点击扩展图标，用B站App扫码授权', 'auth');
    const requestedGeneration = generation;
    const key = `${requestedGeneration}:${profile ? 'p' : 'd'}:${id}:${message.expectedMid || ''}`;
    const saved = cache.get(key);
    if (saved?.until > now()) return saved.value;
    if (pending.has(key)) return pending.get(key);
    const promise = schedule(async () => {
      if (requestedGeneration !== generation) throw new ApiError('授权已变化，请重新查询', 'auth');
      let result;
      try {
        if (profile) result = await (await client()).api.profile(id, auth.accessToken);
        else {
          const data = await dynamicQuery(id, auth.accessToken, { expectedMid: message.expectedMid, deviceId: auth.deviceId });
          if (data.status === 'auth-required' || data.status === 'expired') throw new ApiError('授权已失效，请在扩展中重新授权', 'auth');
          if (data.status !== 'ok' && data.status !== 'empty') throw new ApiError(data.error || '动态接口暂不可用', ['rate', 'network'].includes(data.reason) ? data.reason : 'api');
          if (data.id !== id || (message.expectedMid && data.authorMid && data.authorMid !== message.expectedMid)) throw new ApiError('动态接口返回的内容不匹配');
          result = { ok: true, id, authorMid: data.authorMid || null, location: data.status === 'ok' ? locationText(data.region) : null, status: data.status, source: data.source || 'app-dynamic' };
        }
      } catch (error) {
        if (requestedGeneration !== generation) throw new ApiError('授权已变化，请重新查询', 'auth');
        if (error.reason === 'auth') await clearAuth();
        if (error.reason === 'rate') cooldownUntil = now() + 60000;
        result = failure(error);
      }
      if (requestedGeneration !== generation) return { ok: false, reason: 'auth', error: '授权已变化，请重新查询' };
      const ttl = !result.ok ? 20000 : result.location ? 10 * 60000 : 2 * 60000;
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key, { value: result, until: now() + ttl });
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  async function startAuth() {
    if (startTask) return startTask;
    const requestedGeneration = generation;
    startTask = (async () => {
      const existing = (await chromeApi.storage.session.get(PENDING_KEY))[PENDING_KEY];
      if (existing?.expiresAt > now() + 15000) return { ok: true, url: existing.url, authCode: existing.authCode, expiresAt: existing.expiresAt };
      const result = await (await client()).api.startAuth();
      if (requestedGeneration !== generation) throw new ApiError('本次授权已取消');
      await mutateAuth(async () => {
        if (requestedGeneration !== generation) throw new ApiError('本次授权已取消');
        await chromeApi.storage.session.set({ [PENDING_KEY]: { url: result.url, authCode: result.authCode, expiresAt: result.expiresAt } });
      });
      if (requestedGeneration !== generation) throw new ApiError('本次授权已取消');
      nextPoll = 0;
      previousPoll = { ok: true, status: 'pending' };
      return result;
    })().finally(() => { startTask = null; });
    return startTask;
  }

  async function pollAuth(authCode) {
    const current = (await chromeApi.storage.session.get(PENDING_KEY))[PENDING_KEY];
    if (!current || current.authCode !== authCode || current.expiresAt <= now()) return { ok: true, status: 'expired' };
    if (pollTask) return pollTask;
    if (now() < nextPoll) return previousPoll;
    nextPoll = now() + 2000;
    const requestedGeneration = generation;
    pollTask = (async () => {
      const result = await (await client()).api.pollAuth(authCode);
      if (requestedGeneration !== generation) return { ok: true, status: 'expired' };
      if (result.status === 'authorized') {
        const accepted = await mutateAuth(async () => {
          if (requestedGeneration !== generation) return false;
          await chromeApi.storage.local.set({ [CREDENTIAL_KEY]: result.credential });
          if (requestedGeneration !== generation) return false;
          await chromeApi.storage.session.remove(PENDING_KEY);
          if (requestedGeneration !== generation) return false;
          generation++;
          cache.clear();
          return true;
        });
        if (!accepted) return { ok: true, status: 'expired' };
        await announce();
      } else if (result.status === 'expired') await mutateAuth(async () => {
        if (requestedGeneration === generation) await chromeApi.storage.session.remove(PENDING_KEY);
      });
      // The access token is intentionally never returned to popup/content scripts.
      previousPoll = { ok: true, status: result.status };
      return previousPoll;
    })().finally(() => { pollTask = null; });
    return pollTask;
  }

  return {
    ready,
    async handle(message, sender) {
      try {
        const access = senderAccess(sender, chromeApi.runtime.id);
        if (!access || !KNOWN_TYPES.has(message?.type)) throw new ApiError('不允许的扩展请求');
        if (message.type.startsWith('AUTH_') && access !== 'extension') throw new ApiError('请通过扩展面板管理授权');
        await ready;
        switch (message.type) {
          case 'GET_PROFILE': case 'GET_DYNAMIC': return await lookup(message);
          case 'AUTH_START': return await startAuth();
          case 'AUTH_WEB_START':
            return { ok: false, reason: 'unavailable', error: '网页登录转换授权已停用：B站可能拒绝此方式。请使用B站App扫码授权；已有授权不受影响。' };
          case 'AUTH_POLL': return await pollAuth(message.authCode);
          case 'AUTH_CLEAR': return await clearAuth();
          case 'AUTH_STATUS': {
            const auth = await credential();
            return { ok: true, authorized: Boolean(auth), ...(auth ? { expiresAt: auth.expiresAt } : {}) };
          }
        }
      } catch (error) { return failure(error); }
    },
  };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const background = createBackground(chrome);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!KNOWN_TYPES.has(message?.type)) return false;
    background.handle(message, sender).then(respond);
    return true;
  });
}
