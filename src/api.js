import md5 from 'blueimp-md5';
import {normalizeRegion} from './region.js';

// Public client parameters and protocol: lzghzr/libBilibiliToken (MIT).
// Profile location tags: maxchang3/userscripts/BiliRevealForSpace (MIT).
// See licenses/libBilibiliToken-MIT.txt and licenses/BiliRevealForSpace-MIT.txt.
// Login uses the Android login key; its token is compatible with APP_KEY.
export const LOGIN_APP_KEY = '783bbb7264451d82';
export const APP_KEY = '1d8b6e7d45233436';
const LOGIN_SECRET = '2653583c8873dea268ab9386918b1d65';
const APP_SECRET = '560c52ccd288fed045859ed18bffd973';
export const PROFILE_UA = 'Mozilla/5.0 BiliDroid/6.72.0 os/android mobi_app/android build/6720300 channel/bilih5';

export class ApiError extends Error {
  constructor(message, reason = 'api', code) {
    super(message);
    this.reason = reason;
    this.code = code;
  }
}

// AbortSignal.any was added after our Chrome 111 minimum.
export function requestSignal(signal, milliseconds = 12000) {
  const timeout = AbortSignal.timeout(milliseconds);
  if (!signal) return timeout;
  const controller = new AbortController();
  const abort = source => {
    controller.abort(source.reason);
    signal.removeEventListener('abort', externalAbort);
    timeout.removeEventListener('abort', timedOut);
  };
  const externalAbort = () => abort(signal);
  const timedOut = () => abort(timeout);
  if (signal.aborted) controller.abort(signal.reason);
  else {
    signal.addEventListener('abort', externalAbort, { once: true });
    timeout.addEventListener('abort', timedOut, { once: true });
  }
  return controller.signal;
}

export function validId(value) {
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
}

export function signQuery(params, login = false, timestamp = Math.floor(Date.now() / 1000)) {
  const query = new URLSearchParams({ ...params, ts: String(timestamp) });
  query.sort();
  const body = query.toString();
  return `${body}&sign=${md5(body + (login ? LOGIN_SECRET : APP_SECRET))}`;
}

export function locationText(value) {
  const region = normalizeRegion(value);
  return region ? `IP属地：${region}` : null;
}

export function checkCode(json) {
  if (json?.code === 0) return;
  const code = json?.code;
  if ([-101, -111, -400101, -663, 61000].includes(code)) {
    throw new ApiError('授权已失效，请在扩展中重新授权', 'auth', code);
  }
  if ([-352, -412, 429].includes(code)) {
    throw new ApiError('B站暂时限制了请求，请稍后重试', 'rate', code);
  }
  throw new ApiError(`B站接口暂不可用（${typeof code === 'number' ? code : '响应异常'}）`, 'api', code);
}

export function parseProfile(json, mid) {
  checkCode(json);
  const card = json.data?.card;
  if (!card || typeof card !== 'object') throw new ApiError('个人主页接口未返回用户信息');
  const actualMid = typeof card.mid === 'string' ? card.mid : Number.isSafeInteger(card.mid) ? String(card.mid) : null;
  if (!validId(actualMid) || actualMid !== mid) throw new ApiError('个人主页返回的账号不匹配');
  const tags = [...(Array.isArray(card.space_tag) ? card.space_tag : []), ...(Array.isArray(card.space_tag_bottom) ? card.space_tag_bottom : [])];
  const location = tags.filter(tag => tag?.type === 'location').map(tag => locationText(tag.title)).find(Boolean) || null;
  // card.place and any user-written profile fields are deliberately excluded.
  return { ok: true, mid, location, source: 'app-space', status: location ? 'ok' : 'empty' };
}

export function parseCredential(data, deviceId, now = Date.now()) {
  const token = data?.token_info || data;
  if (!token || typeof token.access_token !== 'string' || !/^[\w-]{16,256}$/.test(token.access_token)) {
    throw new ApiError('授权响应缺少有效凭证，请重新授权');
  }
  const seconds = Number(token.expires_in);
  if (!Number.isFinite(seconds) || seconds <= 60 || seconds > 366 * 86400) {
    throw new ApiError('授权响应缺少有效期限，请重新授权');
  }
  const rawMid = token.mid ?? data.mid;
  const ownerMid = typeof rawMid === 'string' ? rawMid : Number.isSafeInteger(rawMid) ? String(rawMid) : null;
  const outerMid = typeof data.mid === 'string' ? data.mid : Number.isSafeInteger(data.mid) ? String(data.mid) : null;
  if (validId(ownerMid) && validId(outerMid) && ownerMid !== outerMid) throw new ApiError('授权响应中的账号不一致，请重新授权');
  return { accessToken: token.access_token, deviceId, expiresAt: now + seconds * 1000, ...(validId(ownerMid) ? { ownerMid } : {}) };
}

export function createApi(deviceId, { fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now } = {}) {
  async function request(url, body, signal) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST', body,
        credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { buvid: deviceId, ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
        signal: requestSignal(signal),
      });
    } catch {
      if (signal?.aborted) throw new ApiError('本次授权已取消');
      throw new ApiError('连接B站失败或超时，请稍后重试', 'network');
    }
    if (response.status === 401) throw new ApiError('授权已失效，请重新授权', 'auth', 401);
    if ([412, 429].includes(response.status)) throw new ApiError('B站暂时限制了请求，请稍后重试', 'rate', response.status);
    if (!response.ok) throw new ApiError(`B站请求失败（HTTP ${response.status}）`, 'network', response.status);
    try { return await response.json(); }
    catch { throw new ApiError('B站接口返回的数据无法解析'); }
  }
  const sign = (params, login) => signQuery(params, login, Math.floor(now() / 1000));
  const loginQuery = extra => sign({ appkey: LOGIN_APP_KEY, build: '6720300', c_locale: 'zh-Hans_CN', channel: 'website', local_id: deviceId, mobi_app: 'android', platform: 'android', s_locale: 'zh-Hans_CN', ...extra }, true);
  return {
    async profile(mid, accessToken) {
      if (!validId(mid)) throw new ApiError('个人主页账号无效');
      if (!accessToken) throw new ApiError('请先在扩展中完成授权', 'auth');
      const query = sign({ appkey: APP_KEY, build: '6720300', mobi_app: 'android', vmid: mid, access_key: accessToken });
      return parseProfile(await request(`https://app.bilibili.com/x/v2/space?${query}`), mid);
    },
    async startAuth({ signal } = {}) {
      const json = await request('https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code', loginQuery({}), signal);
      checkCode(json);
      const code = json.data?.auth_code;
      let url;
      try { url = new URL(json.data?.url); } catch { throw new ApiError('二维码响应无效，请重试'); }
      if (typeof code !== 'string' || !/^[\w-]{16,256}$/.test(code) || url.origin !== 'https://passport.bilibili.com' || url.pathname !== '/x/passport-tv-login/h5/qrcode/auth' || url.searchParams.get('auth_code') !== code) {
        throw new ApiError('二维码响应无效，请重试');
      }
      return { ok: true, url: url.href, authCode: code, expiresAt: now() + 180000 };
    },
    async pollAuth(authCode, { signal } = {}) {
      if (typeof authCode !== 'string' || !/^[\w-]{16,256}$/.test(authCode)) throw new ApiError('二维码无效，请重新获取');
      const json = await request('https://passport.bilibili.com/x/passport-tv-login/qrcode/poll', loginQuery({ auth_code: authCode }), signal);
      if (json.code === 86039) return { ok: true, status: 'pending' };
      if (json.code === 86090) return { ok: true, status: 'scanned' };
      if (json.code === 86038) return { ok: true, status: 'expired' };
      checkCode(json);
      return { ok: true, status: 'authorized', credential: parseCredential(json.data, deviceId, now()) };
    },
  };
}
