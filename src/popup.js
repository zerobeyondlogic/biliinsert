import QRCode from 'qrcode';

const $ = (id) => document.getElementById(id);
const standalone = new URLSearchParams(location.search).get('authorize') === '1';
const commentsToggle = $('comments-toggle');
const profileToggle = $('profile-toggle');
const dynamicToggle = $('dynamic-toggle');
const subscribeTimeToggle = $('subscribe-time-toggle');
const authorizeButton = $('authorize-button');
const clearButton = $('clear-button');
const qrPanel = $('qr-panel');
const qrStatus = $('qr-status');
let authorized = false;
let pollingTimer = null;
let session = 0;
let deadline = 0;
let saveQueue = Promise.resolve();
let statusTimer = null;

if (standalone) {
  document.documentElement.classList.add('standalone-page');
  document.body.classList.add('standalone');
}
$('version').textContent = `v${chrome.runtime.getManifest().version}`;

function message(text, tone = 'success') {
  $('message').textContent = text;
  $('message').dataset.tone = tone;
  $('message').hidden = !text;
}

async function send(type, data = {}) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type, ...data });
  } catch {
    throw new Error('暂时无法连接扩展后台，请关闭此页面后重新打开。');
  }
  if (!response?.ok) throw new Error(response?.error || '请求未完成，请稍后重试。');
  return response;
}

function stopPolling() {
  session += 1;
  clearTimeout(pollingTimer);
  pollingTimer = null;
}

function renderAuth() {
  $('auth-state').dataset.state = authorized ? 'authorized' : 'unauthorized';
  $('auth-state').textContent = authorized ? '已授权' : '未授权';
  $('auth-description').textContent = authorized
    ? '授权已保存在本机，无需重复扫码。刷新 B站页面，即可查询个人主页与动态的属地。'
    : '评论和关注时间可直接使用。个人主页与动态属地需要用 B站 App 扫码授权一次。';
  authorizeButton.textContent = authorized ? '重新扫码授权' : '扫码授权';
  authorizeButton.disabled = false;
  authorizeButton.hidden = !qrPanel.hidden;
  clearButton.hidden = !authorized || !qrPanel.hidden;
}

async function refreshAuth() {
  const state = await send('AUTH_STATUS');
  authorized = state.authorized === true;
  renderAuth();
  return authorized;
}

function finishScan(text, tone = 'success') {
  stopPolling();
  qrPanel.hidden = true;
  $('qr-code').getContext('2d').clearRect(0, 0, 224, 224);
  renderAuth();
  message(text, tone);
}

async function poll(authCode, activeSession, failures = 0) {
  if (activeSession !== session) return;
  if (Date.now() >= deadline) {
    finishScan('二维码已过期，请重新点击扫码授权。', 'error');
    return;
  }
  try {
    const result = await send('AUTH_POLL', { authCode });
    if (activeSession !== session) return;
    if (result.status === 'authorized') {
      authorized = true;
      finishScan('授权成功。现在可以返回 B站，刷新页面查看属地。');
      return;
    }
    if (result.status === 'expired') {
      finishScan('二维码已过期，请重新点击扫码授权。', 'error');
      return;
    }
    if (!['pending', 'scanned'].includes(result.status)) {
      finishScan('B站返回了未识别的授权状态，请重新扫码。', 'error');
      return;
    }
    qrStatus.textContent = result.status === 'scanned' ? '已扫码，请在手机上确认' : '请使用 B站手机 App 扫码';
    pollingTimer = setTimeout(() => poll(authCode, activeSession), 4000);
  } catch (error) {
    if (activeSession !== session) return;
    if (failures >= 2) {
      finishScan(error.message, 'error');
      return;
    }
    qrStatus.textContent = '连接暂时中断，正在重试…';
    pollingTimer = setTimeout(() => poll(authCode, activeSession, failures + 1), 4000);
  }
}

async function startScan() {
  stopPolling();
  const activeSession = session;
  message('');
  authorizeButton.disabled = true;
  authorizeButton.textContent = '正在生成二维码…';
  clearButton.hidden = true;
  try {
    const result = await send('AUTH_START');
    if (activeSession !== session) return;
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.hostname !== 'passport.bilibili.com' || typeof result.authCode !== 'string' || !result.authCode) {
      throw new Error('B站返回的二维码信息无效，请稍后重试。');
    }
    await QRCode.toCanvas($('qr-code'), url.href, {
      width: 224, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#17202cff', light: '#ffffffff' },
    });
    if (activeSession !== session) return;
    qrPanel.hidden = false;
    authorizeButton.hidden = true;
    qrStatus.textContent = '请使用 B站手机 App 扫码';
    // Each QR session is bounded; a new code requires another user action.
    deadline = Number.isFinite(result.expiresAt)
      ? Math.min(result.expiresAt, Date.now() + 180_000)
      : Date.now() + 180_000;
    pollingTimer = setTimeout(() => poll(result.authCode, activeSession), 4000);
  } catch (error) {
    if (activeSession !== session) return;
    qrPanel.hidden = true;
    renderAuth();
    message(error.message, 'error');
  }
}

authorizeButton.addEventListener('click', async () => {
  if (standalone) {
    await startScan();
    return;
  }
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?authorize=1') });
    window.close();
  } catch {
    message('无法打开扫码页面，请重新打开扩展后重试。', 'error');
  }
});

$('cancel-button').addEventListener('click', () => finishScan('已停止本次扫码。'));

clearButton.addEventListener('click', async () => {
  clearButton.disabled = true;
  authorizeButton.disabled = true;
  try {
    await send('AUTH_CLEAR');
    authorized = false;
    finishScan('已清除本机授权。若要撤销设备登录，请在 B站账号设置中管理登录设备。');
  } catch (error) {
    message(error.message, 'error');
  } finally {
    clearButton.disabled = false;
    authorizeButton.disabled = false;
  }
});

function saveSettings() {
  const settings = { comments: commentsToggle.checked, profile: profileToggle.checked, dynamic: dynamicToggle.checked, subscribeTime: subscribeTimeToggle.checked };
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    try {
      const existing = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...existing.settings, ...settings } });
      message('显示设置已保存。');
    } catch {
      message('设置保存失败，请稍后重试。', 'error');
    }
  });
}
commentsToggle.addEventListener('change', saveSettings);
profileToggle.addEventListener('change', saveSettings);
dynamicToggle.addEventListener('change', saveSettings);
subscribeTimeToggle.addEventListener('change', saveSettings);

// An authorization tab may complete while a second settings view remains open.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local' || !qrPanel.hidden) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => refreshAuth().catch(() => {}), 150);
});
window.addEventListener('pagehide', stopPolling);

async function init() {
  try {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    commentsToggle.checked = settings.comments !== false;
    profileToggle.checked = settings.profile !== false;
    dynamicToggle.checked = settings.dynamic !== false;
    subscribeTimeToggle.checked = settings.subscribeTime !== false;
  } catch {
    message('暂时无法读取显示设置。', 'error');
  }
  try {
    await refreshAuth();
    if (standalone) await startScan();
  } catch (error) {
    $('auth-state').textContent = '暂不可用';
    authorizeButton.disabled = false;
    message(error.message, 'error');
  }
}

void init();
