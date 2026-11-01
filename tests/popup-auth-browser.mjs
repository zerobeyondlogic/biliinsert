import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// UI-contract fixtures only. This test does not log in, access cookies, request
// real browser permissions or contact Bilibili's login/confirmation endpoints.
const html = await readFile('static/popup.html', 'utf8');
const css = await readFile('static/popup.css', 'utf8');
const source = await readFile('src/popup.js', 'utf8');
assert.doesNotMatch(source, /AUTH_WEB_START|chrome\.permissions|chrome\.cookies/);
assert.doesNotMatch(html, /web-authorize-button|Cookie/);
const bundle = (await build({ entryPoints: ['src/popup.js'], bundle: true, write: false, platform: 'browser' })).outputFiles[0].text;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], pages = [];

async function fixture({ authorized = false, standalone = false } = {}) {
  const page = await browser.newPage({ viewport: { width: standalone ? 320 : 900, height: 1000 } });
  pages.push(page); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(authorized => {
    const state = window.__test = { authorized, calls: [], permissions: 0, opened: [], closed: false, saved: {} };
    window.close = () => { state.closed = true; };
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '0.2.2' }),
        getURL: file => `https://extension.test/${file}`,
        sendMessage: async request => {
          state.calls.push(request.type);
          if (request.type === 'AUTH_STATUS') return { ok: true, authorized: state.authorized };
          if (request.type === 'AUTH_START') return { ok: true, authCode: 'fixture-code', url: 'https://passport.bilibili.com/test?auth_code=fixture-code', expiresAt: Date.now() + 180000 };
          if (request.type === 'AUTH_POLL') { state.authorized = true; return { ok: true, status: 'authorized' }; }
          if (request.type === 'AUTH_CLEAR') { state.authorized = false; return { ok: true }; }
          throw new Error(`Unexpected message: ${request.type}`);
        },
      },
      permissions: { request: () => { state.permissions++; throw new Error('Permission request forbidden in QR-only UI'); } },
      storage: { sync: { get: async () => ({ settings: state.saved }), set: async data => { state.saved = data.settings; } }, onChanged: { addListener() {} } },
      tabs: { create: async options => { state.opened.push(options.url); } },
    };
  }, authorized);
  await page.route('https://extension.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html',
      body: pathname.endsWith('.js') ? bundle : pathname.endsWith('.css') ? css : html });
  });
  await page.goto(`https://extension.test/popup.html${standalone ? '?authorize=1' : ''}`);
  return page;
}

try {
  const existing = await fixture({ authorized: true });
  await existing.waitForFunction(() => document.querySelector('#auth-state').textContent === '已授权');
  assert.deepEqual(await existing.evaluate(() => __test.calls), ['AUTH_STATUS'], 'valid authorization must be preserved without renewing/clearing');
  assert.equal(await existing.locator('#authorize-button').innerText(), '重新扫码授权');
  assert.match(await existing.locator('#auth-description').innerText(), /无需重复扫码/);
  assert.equal(await existing.locator('#clear-button').isVisible(), true);
  assert.equal(await existing.evaluate(() => getComputedStyle(document.documentElement).minWidth), '360px');
  assert.equal(await existing.locator('input[role="switch"]').count(), 4);
  await existing.locator('label[for="subscribe-time-toggle"]').click();
  await existing.waitForFunction(() => __test.saved.subscribeTime === false);
  assert.deepEqual(await existing.evaluate(() => __test.saved), { comments: true, profile: true, dynamic: true, subscribeTime: false });

  const popup = await fixture();
  await popup.waitForFunction(() => !document.querySelector('#authorize-button').disabled);
  assert.equal(await popup.locator('#authorize-button').innerText(), '扫码授权');
  assert.match(await popup.locator('#auth-description').innerText(), /评论和关注时间可直接使用/);
  assert.equal(await popup.locator('#web-authorize-button').count(), 0);
  await popup.locator('#authorize-button').click();
  await popup.waitForFunction(() => __test.closed);
  assert.deepEqual(await popup.evaluate(() => __test.opened), ['https://extension.test/popup.html?authorize=1']);
  assert.deepEqual(await popup.evaluate(() => __test.calls), ['AUTH_STATUS']);

  const scan = await fixture({ standalone: true });
  await scan.locator('#qr-panel').waitFor({ state: 'visible' });
  assert.equal(await scan.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, JSON.stringify(await scan.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.getBoundingClientRect().width, app: document.querySelector('.app').getBoundingClientRect().width, overflow: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag:el.tagName, class:el.className, width:el.getBoundingClientRect().width })) }))));
  await scan.locator('#cancel-button').click();
  await scan.locator('#qr-panel').waitFor({ state: 'hidden' });
  await scan.locator('#authorize-button').click();
  await scan.locator('#qr-panel').waitFor({ state: 'visible' });
  await scan.waitForFunction(() => document.querySelector('#auth-state').textContent === '已授权');
  await scan.locator('#clear-button').click();
  await scan.waitForFunction(() => document.querySelector('#auth-state').textContent === '未授权');
  for (const page of pages) {
    assert.equal(await page.evaluate(() => __test.permissions), 0);
    assert.equal(await page.evaluate(() => __test.calls.includes('AUTH_WEB_START')), false);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: QR-only UI; no web-auth messages/permission requests; existing authorization retained; four settings; QR open/cancel/authorize/clear; fixed popup width and responsive 320px QR page. All auth responses were fixtures.');
} finally { await browser.close(); }
