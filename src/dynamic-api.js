// Adapted from Chihiro521/bili-ip-region (MIT), probe.ts and dynamic-api.ts.
// Copyright (c) 2026 Chihiro521. See licenses/bili-ip-region-MIT.txt.
import { concat, decodeDynamicResponse, intField, requestBody, stringField, validateDynamicId } from './dynamic-protocol.js';

export const MOBILE_UA = 'Dalvik/2.1.0 (Linux; U; Android 11) 9.14.0 mobi_app/android build/9140400 grpc-java-cronet/1.36.1';
export const DYNAMIC_ENDPOINT_PATTERN = '^https://app\\.bilibili\\.com/bilibili\\.app\\.dynamic\\.v2\\.(Dynamic/DynDetail|Opus/OpusDetail)$';
function base64(bytes) { return btoa(String.fromCharCode(...bytes)); }

export function dynamicHeaders(deviceId, accessToken) {
  if (typeof deviceId !== 'string' || !/^[\w-]{8,128}$/.test(deviceId)) throw new Error('设备标识无效');
  if (typeof accessToken !== 'string' || !/^[\w-]{8,512}$/.test(accessToken)) throw new Error('授权凭据无效');
  return {
    'content-type': 'application/grpc',
    'grpc-accept-encoding': 'identity',
    authorization: `identify_v1 ${accessToken}`,
    'x-bili-metadata-bin': base64(concat(
      stringField(1, accessToken), stringField(2, 'android'), stringField(3, 'phone'),
      intField(4, 9140400n), stringField(5, 'yingyongbao'), stringField(6, deviceId), stringField(7, 'android'),
    )),
    'x-bili-device-bin': base64(concat(
      intField(1, 1n), intField(2, 9140400n), stringField(3, deviceId), stringField(4, 'android'),
      stringField(5, 'android'), stringField(6, 'phone'), stringField(7, 'yingyongbao'),
      stringField(10, '11'), stringField(13, '9.14.0'),
    )),
    'x-bili-network-bin': 'CAEaBTQ2MDAx',
    'x-bili-locale-bin': 'CggKAnpoGgJDThIICgJ6aBoCQ04',
    'x-bili-fawkes-req-bin': 'CglhbmRyb2lkNjQSBHByb2QaCDlhMjU2NWM2',
    buvid: deviceId,
    'bili-http-engine': 'cronet',
  };
}

/** Query this post's publication region, never an author's current profile region. */
export async function queryDynamic(id, accessToken, options = {}) {
  const expectedMid = options.expectedMid ?? null;
  const result = (status, extras = {}) => ({ id, authorMid: expectedMid, status, region: null, ...extras });
  try {
    validateDynamicId(id);
    if (expectedMid !== null && (typeof expectedMid !== 'string' || !/^[1-9]\d{0,19}$/.test(expectedMid))) {
      return result('error', { error: '作者 UID 无效' });
    }
  } catch { return result('error', { error: '动态 ID 无效' }); }
  if (!accessToken) return result('auth-required');
  let headers;
  try { headers = dynamicHeaders(options.deviceId ?? 'XX' + crypto.randomUUID().replaceAll('-', ''), accessToken); }
  catch { return result('error', { error: '动态查询的授权或设备信息无效' }); }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let failure = null, failureReason = 'api', hadValidEmpty = false, authorMid = expectedMid;
  for (const method of ['DynDetail', 'OpusDetail']) {
    const service = method === 'DynDetail' ? 'Dynamic' : 'Opus';
    let responseReceived = false;
    try {
      const response = await fetchImpl(`https://app.bilibili.com/bilibili.app.dynamic.v2.${service}/${method}`, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers,
        body: requestBody(method, id), signal: AbortSignal.timeout(12000),
      });
      responseReceived = true;
      const grpcStatus = response.headers.get('grpc-status');
      // Bilibili also reports application errors in grpc-message with grpc-status 2.
      // Only recognized authentication codes invalidate credentials. 4101105 is a
      // content/request error, not an authentication error (an absent post can return it).
      const rawGrpcMessage = response.headers.get('grpc-message') || '';
      let grpcMessage = rawGrpcMessage;
      try { grpcMessage = decodeURIComponent(rawGrpcMessage); } catch { /* Use the undecoded header. */ }
      const businessCode = /^-?\d{1,10}$/.test(grpcMessage.trim()) ? grpcMessage.trim() : null;
      if (response.status === 401 || grpcStatus === '16' || (grpcStatus && grpcStatus !== '0' && ['-101', '-2'].includes(businessCode))) {
        return result('auth-required', { reason: 'auth', error: '动态查询授权已失效，请重新扫码' });
      }
      if ([412, 429].includes(response.status) || grpcStatus === '8') {
        return result('error', { reason: 'rate', error: 'B站暂时限制了请求，请稍后重试' });
      }
      if (!response.ok) { failure = `动态接口 HTTP ${response.status}`; failureReason = 'api'; continue; }
      if (grpcStatus && grpcStatus !== '0') {
        failureReason = 'api';
        failure = businessCode === '4101105' ? '动态内容暂不可用（4101105）'
          : `动态接口错误（gRPC ${/^\d{1,2}$/.test(grpcStatus) ? grpcStatus : '?'}${businessCode ? ` / ${businessCode}` : ''}）`;
        continue;
      }
      if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) {
        failure = '动态响应过大'; failureReason = 'api'; continue;
      }
      const decoded = decodeDynamicResponse(method, new Uint8Array(await response.arrayBuffer()));
      if (decoded.returnedId !== id) return result('error', { error: '返回动态 ID 与请求不一致' });
      if (!decoded.authorMid || decoded.authorMid === '0' || (expectedMid && decoded.authorMid !== expectedMid)
        || (authorMid && decoded.authorMid !== authorMid)) return result('error', { error: '返回动态作者与当前内容不一致' });
      authorMid = decoded.authorMid;
      if (decoded.region) return result('ok', { authorMid, region: decoded.region, source: `${method}:${decoded.locationSource}` });
      hadValidEmpty = true;
    } catch (error) {
      // Never return upstream response bodies or credentials to page scripts.
      failure = error?.name === 'TimeoutError' ? '动态查询超时' : '动态接口不可用或响应格式无效';
      failureReason = responseReceived ? 'api' : 'network';
    }
  }
  // An incomplete fallback is not evidence that the location is absent.
  return result(hadValidEmpty && !failure ? 'empty' : 'error', { authorMid, ...(failure ? { error: failure, reason: failureReason } : {}) });
}
