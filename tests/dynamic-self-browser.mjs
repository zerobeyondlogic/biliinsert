import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { bytesField, concat, grpcFrame, intField, stringField, requestBody } from '../src/dynamic-protocol.js';

// All IDs, App responses and the stored credential below are synthetic. The
// test loads the complete unpacked extension into a new Chromium profile.
const samples = [
  ['801', '100', '215浏览 IP属地：上海'],
  ['802', '200', '上海'],
  ['803', '100', '上海'], // Runtime response overridden below to test old wrapped data.
  ['804', '100', '215浏览 IP属地：上海'],
  ['805', '100', '215浏览 IP属地：上海'],
  ['806', '100', '999浏览 IP属地：福建'],
  ['807', '300', '北京'],
  ['809', '100', null],
];
const fixtures = samples.flatMap(([id, mid, rawLocation]) => ['DynDetail', 'OpusDetail'].map(method => {
  const opus = method === 'OpusDetail';
  const author = concat(intField(1, BigInt(mid)), ...(rawLocation ? [stringField(14, rawLocation)] : []));
  const item = concat(...(opus ? [intField(1, BigInt(id))] : []),
    bytesField(opus ? 4 : 3, bytesField(2, author)), bytesField(opus ? 5 : 4, stringField(1, id)));
  return { id, request: [...requestBody(method, id)].join(','), response: [...grpcFrame(bytesField(1, item))] };
}));
const cached = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  || (existsSync(chromium.executablePath()) ? undefined : existsSync(cached) ? cached : undefined);
const profile = await mkdtemp(path.join(tmpdir(), 'bili-self-dynamic-test-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath, headless: true, channel: executablePath ? undefined : 'chromium', viewport: { width: 1100, height: 1000 },
  args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`],
});
context.setDefaultTimeout(15000);
const errors = [];
const style = `<style>body{margin:48px auto;max-width:860px;background:#18191c;color:#e3e5e7;font:15px system-ui,"Microsoft YaHei",sans-serif}h1{font-size:24px}.note{font-size:12px;color:#9499a0;margin-bottom:26px}article{padding:24px;background:#232427;border:1px solid #333;border-radius:10px;margin:18px 0}h2{font-size:17px;margin:0 0 14px}.bili-dyn-item__meta,.bili-dyn-time,.opus-module-author__pub{font-size:13px;color:#9499a0}.native-views,.native-region{margin-inline-start:12px}.body{line-height:1.8;margin:22px 0 2px;color:#d5d7db}</style>`;
const listHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">${style}<body><h1>自己的动态列表 · 模拟回归页面</h1><p class="note">所有账号与属地均为测试数据；用于验证浏览量与 IP 属地分开显示。</p>
<article class="bili-dyn-item" id="self"><h2>自己的动态：手机接口混合字段</h2><div class="bili-dyn-item__meta"><span class="bili-dyn-time">今天 12:30</span><span class="native-views">215浏览</span></div><p class="body">正文正常保留。这里提到“IP属地：广东”只是正文，不是原生元信息标签。</p></article>
<article class="bili-dyn-item" id="other"><h2>其他人的动态：普通地区字段</h2><div class="bili-dyn-item__meta"><span class="bili-dyn-time">今天 12:00</span></div><p class="body">普通属地也应正常显示。</p></article>
<article class="bili-dyn-item" id="wrapped"><h2>旧格式结果：前端再次规范化</h2><div class="bili-dyn-item__meta"><span class="bili-dyn-time">昨天 18:30</span><span class="native-views">215浏览</span></div></article>
<article class="bili-dyn-item" id="race"><h2>动态节点复用测试</h2><div class="bili-dyn-item__meta"><span class="bili-dyn-time">昨天 17:30</span></div></article>
<script>const bind=(node,id,mid)=>{document.querySelector(node).__vueParentComponent={props:{data:{id_str:id,modules:{module_author:{mid}}}}}};bind('#self','801','100');bind('#other','802','200');bind('#wrapped','803','100');bind('#race','809','100');</script></body></html>`;
function detailHtml(id, nativeRegion = false) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">${style}<body><h1>自己的动态详情 · 模拟回归页面</h1><p class="note">模拟接口原文为“215浏览 IP属地：上海”；下方浏览量来自页面原生内容，扩展只补充属地。</p><article><h2>测试用户发布的动态</h2><div class="opus-module-author"><div class="opus-module-author__pub"><span class="native-time">2026年11月1日 12:30</span><span class="native-views">215浏览</span>${nativeRegion ? '<span class="native-region">IP属地：上海</span>' : ''}</div></div><p class="body">阅读数量和 IP 属地分别展示，不重复添加“215浏览”。</p></article><script>document.querySelector('.opus-module-author__pub').__vueParentComponent={props:{id:'${id}',author:{mid:'100'}}};</script></body></html>`;
}
function count(text, needle) { return text.split(needle).length - 1; }

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async fixtures => {
    globalThis.selfFixtureCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      const fixture = fixtures.find(item => item.request === [...(init.body || [])].join(','));
      if (!fixture) throw new Error(`Unexpected fixture request: ${new URL(url).pathname}`);
      selfFixtureCalls.push({ id: fixture.id, path: new URL(url).pathname });
      if (fixture.id === '806') await new Promise(resolve => setTimeout(resolve, 1400));
      return new Response(Uint8Array.from(fixture.response), { headers: { 'grpc-status': '0' } });
    };
    // This synchronous fixture listener wins the response race for one known
    // test ID, bypassing backend normalization to exercise content.js itself.
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'GET_DYNAMIC' && message.id === '803') {
        sendResponse({ ok: true, id: '803', authorMid: '100', location: 'IP属地：215浏览 IP属地：上海' });
      }
    });
    await chrome.storage.local.set({ biliIpCredential: {
      accessToken: 'fixture-only-token-no-account', deviceId: 'fixture-self-dynamic-device', expiresAt: Date.now() + 86400000,
    } });
    await chrome.storage.sync.set({ settings: { profile: false, dynamic: true, comments: false, subscribeTime: false } });
  }, fixtures);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.route('https://space.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: listHtml }));
  await page.route('https://www.bilibili.com/opus/**', route => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ contentType: 'text/html', body: detailHtml(id, id === '805') });
  });
  await page.goto('https://space.bilibili.com/100/dynamic');
  for (const selector of ['#self', '#other', '#wrapped']) {
    await page.waitForFunction(selector => document.querySelector(`${selector} .brp-label`)?.textContent === 'IP属地：上海', selector);
    assert.equal(await page.locator(`${selector} .brp-label`).count(), 1);
  }
  for (const selector of ['#self', '#wrapped']) {
    const text = await page.locator(`${selector} .bili-dyn-item__meta`).innerText();
    assert.equal(count(text, '215浏览'), 1, 'native count must remain exactly once');
    assert.equal(count(text, 'IP属地：上海'), 1, 'IP label must contain region only');
    assert.doesNotMatch(text, /IP属地[：:]\s*215/);
  }
  assert.match(await page.locator('#self .body').innerText(), /IP属地：广东/, 'body content must not be changed or treated as native IP metadata');
  for (let index = 0; index < 4; index++) {
    await page.evaluate(index => { document.querySelector('#self .bili-dyn-time').textContent = `今天 12:${30 + index}`; }, index);
    await page.waitForTimeout(160);
  }
  assert.equal(await page.locator('#self .brp-label').count(), 1, 'repeated renders must not duplicate or self-remove the label');
  assert.equal(await page.locator('#self .brp-label').innerText(), 'IP属地：上海');

  // A delayed response belonging to the recycled node's old ID must not stick.
  await page.evaluate(() => { const item = document.querySelector('#race'); item.__vueParentComponent.props.data = { id_str: '806', modules: { module_author: { mid: '100' } } }; item.querySelector('.bili-dyn-time').textContent = '刚刚'; });
  await page.waitForFunction(() => document.querySelector('#race .bili-dyn-time').getAttribute('data-brp-binding')?.includes('806'));
  await worker.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (selfFixtureCalls.some(call => call.id === '806')) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Delayed dynamic fixture was not requested');
  });
  await page.evaluate(() => { const item = document.querySelector('#race'); item.__vueParentComponent.props.data = { id_str: '807', modules: { module_author: { mid: '300' } } }; item.querySelector('.bili-dyn-time').textContent = '1 秒前'; });
  await page.waitForFunction(() => document.querySelector('#race .brp-label')?.textContent === 'IP属地：北京');
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('#race .brp-label').innerText(), 'IP属地：北京');
  assert.equal(await page.locator('#race .brp-label').count(), 1);

  await page.goto('https://www.bilibili.com/opus/804');
  await page.waitForFunction(() => document.querySelector('.opus-module-author__pub .brp-label')?.textContent === 'IP属地：上海');
  const detailText = await page.locator('.opus-module-author__pub').innerText();
  assert.equal(count(detailText, '215浏览'), 1);
  assert.equal(count(detailText, 'IP属地：上海'), 1);
  assert.equal(await page.locator('.native-views').innerText(), '215浏览');
  assert.equal(await page.locator('.native-time').innerText(), '2026年11月1日 12:30');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/self-dynamic-fixed.png', fullPage: true });

  await page.goto('https://www.bilibili.com/opus/805');
  await page.waitForFunction(() => document.querySelector('.opus-module-author__pub').getAttribute('data-brp-binding')?.includes('805'));
  await page.waitForFunction(() => document.querySelector('.opus-module-author__pub').dataset.brpStatus === 'ok');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.opus-module-author__pub .brp-label').count(), 0, 'existing native IP metadata must prevent an extra extension label');
  const nativeText = await page.locator('.opus-module-author__pub').innerText();
  assert.equal(count(nativeText, '215浏览'), 1);
  assert.equal(count(nativeText, 'IP属地：上海'), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: full extension; self-space mixed App field; direct legacy wrapped response; normal other-user region; native view-count preservation; repeated render; stale-ID response; opus native IP deduplication. All account/API data were fixtures.');
} finally { await context.close(); }
