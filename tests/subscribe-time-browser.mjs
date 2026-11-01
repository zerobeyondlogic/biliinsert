import { chromium } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// All requests/identities below are fixtures. No user's cookies or account are used.
const entryPoints = ['src/comments-main.js', 'src/comments-content.js', 'src/subscribe-time-main.js', 'src/subscribe-time-content.js'];
const bundles = [];
for (const entry of entryPoints) bundles.push((await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', target: 'chrome111' })).outputFiles[0].text);
const errors = [], contexts = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const fixtureTime = 1_700_000_000;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
body{margin:24px;font:14px system-ui;color:#222}.note{color:#9499a0;font-size:12px;margin-bottom:50px}.actions{display:flex;gap:12px;justify-content:flex-end;margin:60px 0 28px}.actions button{width:88px;height:34px;flex:0 0 auto;border:1px solid #ddd;background:#fff;border-radius:4px}.relation-card-info{padding:24px 0;border-bottom:1px solid #eee}.relation-card-info__sign{color:#9499a0;font-size:12px}
</style><body><p class="note">测试数据 · 非真实账号的关注时间</p><div class="actions"><button class="space-head-follow b-follow"><span>已关注</span></button><button id="message-button">发消息</button></div><div class="relation-card-info"><a class="relation-card-info__uname" href="https://space.bilibili.com/333">测试用户</a><div class="relation-card-info__sign">测试签名</div></div><div id="comments"></div><script>
class Actions extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'});this.shadowRoot.innerHTML='<span id="pubdate" style="color:#9499a0;font-size:12px">昨天</span>';}update(){return 'native';}}
customElements.define('bili-comment-action-buttons-renderer',Actions);
const comment=document.createElement('bili-comment-action-buttons-renderer');comment.data={rpid_str:'9901',oid_str:'22',reply_control:{location:'IP属地：浙江'}};document.querySelector('#comments').append(comment);comment.update();
document.querySelector('#message-button')?.addEventListener('click',()=>{window.messageClicked=true});
</script></body></html>`;

async function pageFor(url, { enabled = true, listOnly = false, width = 360 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 740 } }); contexts.push(context);
  context.setDefaultTimeout(8000);
  await context.addInitScript({ content: `(() => {
    const state = window.__test = { viewer:'100', enabled:${enabled}, calls:[], pending:[], rows:[{mid:333,mtime:${fixtureTime}}], profileBodies:{}, listeners:[] };
    state.settings = () => ({comments:true,subscribeTime:state.enabled});
    state.setEnabled = value => { state.enabled=value;for(const listener of state.listeners)listener({settings:{newValue:state.settings()}},'sync'); };
    state.resolve = (kind, body) => { const index=state.pending.findIndex(item=>item.kind===kind);if(index<0)throw new Error('No deferred '+kind);const [item]=state.pending.splice(index,1);item.resolve(new Response(JSON.stringify(body??item.body),{headers:{'content-type':'application/json'}})); };
    window.fetch = (input) => {
      const url=new URL(typeof input==='string'?input:input.url,location.href);const target=url.searchParams.get('mid');state.calls.push(url.pathname+url.search);
      const kind=url.pathname==='/x/web-interface/nav'?'nav':url.pathname==='/x/web-interface/relation'?'profile':url.pathname.includes('/modify')?'mutation':'list';
      const body=kind==='nav'?{code:0,data:{isLogin:!!state.viewer,mid:state.viewer}}:kind==='profile'?(state.profileBodies[target]??{code:0,data:{relation:{mid:target,attribute:2,mtime:${fixtureTime}},be_relation:{mid:state.viewer}}}):kind==='mutation'?{code:0}:{code:0,data:{list:state.rows}};
      const promise=url.searchParams.has('slow')?new Promise(resolve=>state.pending.push({kind,body,resolve})):Promise.resolve(new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}));
      state.lastOriginalPromise=promise;return promise;
    };
    window.chrome={storage:{sync:{get:async()=>({settings:state.settings()})},onChanged:{addListener:listener=>state.listeners.push(listener)}}};
  })();\n${bundles.join('\n')}` });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.route('https://space.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: listOnly ? html.replace(/<div class="actions">.*?<\/div>/s, '') : html }));
  await page.route('https://api.bilibili.com/**', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://space.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data: { list: [{ mid: 333, mtime: fixtureTime - 86400 }] } }) }));
  await page.goto(url);
  return page;
}
const label = '[data-brp-subscribe-time]';
async function waitCaption(page, text) {
  await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].some(el => el.textContent.includes(text)), { selector: label, text });
}

try {
  const profile = await pageFor('https://space.bilibili.com/222');
  const before = await profile.locator('#message-button').boundingBox();
  await waitCaption(profile, '你关注 Ta 于');
  const after = await profile.locator('#message-button').boundingBox();
  assert.deepEqual(after, before, 'time label must not move the action buttons');
  const geometry = await profile.locator(label).evaluate(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { left: rect.left, right: rect.right, width: innerWidth, position: style.position, pointerEvents: style.pointerEvents, fontSize: style.fontSize };
  });
  assert.equal(geometry.position, 'absolute'); assert.equal(geometry.pointerEvents, 'none'); assert.equal(geometry.fontSize, '12px');
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width, 'label stays within narrow viewport');
  await profile.locator('#message-button').click(); assert.equal(await profile.evaluate(() => window.messageClicked), true);
  await profile.waitForFunction(() => document.querySelector('bili-comment-action-buttons-renderer')?.shadowRoot.querySelector('[data-brp-comment-location]')?.textContent === 'IP属地：浙江');
  const initialCalls = await profile.evaluate(() => __test.calls.length);
  await profile.evaluate(() => __test.setEnabled(false));
  await profile.waitForFunction(() => !document.querySelector('[data-brp-subscribe-time]'));
  assert.equal(await profile.locator('.b-follow').evaluate(el => el.style.position), '', 'restore original positioning');
  await profile.evaluate(() => { history.pushState({}, '', '/444'); document.querySelector('.b-follow span').textContent = '已关注'; });
  await profile.waitForTimeout(300);
  assert.equal(await profile.evaluate(() => __test.calls.length), initialCalls, 'disabled feature must not request another profile');
  await profile.evaluate(() => __test.setEnabled(true));
  await profile.waitForFunction(() => document.querySelector('[data-brp-subscribe-key="profile:100:444"]'));
  assert.equal(await profile.locator(label).count(), 1);
  await mkdir('artifacts', { recursive: true });
  await profile.screenshot({ path: 'artifacts/subscribe-time-fixture.png', fullPage: true });
  await profile.evaluate(() => {
    window.detachedFollowButton = document.querySelector('.b-follow');
    const replacement = document.createElement('button'); replacement.className = 'space-head-follow b-follow';
    replacement.innerHTML = '<span>已关注</span>'; detachedFollowButton.replaceWith(replacement);
  });
  await profile.waitForFunction(() => detachedFollowButton.style.position === '' && !detachedFollowButton.querySelector('[data-brp-subscribe-time]'));
  await profile.waitForFunction(() => document.querySelector('[data-brp-subscribe-key="profile:100:444"]'));

  // A profile response started under the old account must not enter the new account's cache.
  await profile.evaluate(() => {
    void fetch('https://api.bilibili.com/x/web-interface/relation?mid=444&slow=1');
    __test.viewer = '300';
    __test.profileBodies['444'] = { code: 0, data: { relation: { mid: '444', attribute: 0, mtime: 0 } } };
  });
  await profile.evaluate(() => fetch('https://api.bilibili.com/x/web-interface/nav').then(response => response.json()));
  await profile.waitForTimeout(300);
  await profile.evaluate(() => __test.resolve('profile', { code: 0, data: { relation: { mid: '444', attribute: 2, mtime: 1700000000 } } }));
  await profile.waitForTimeout(300);
  assert.equal(await profile.locator(label).count(), 0, 'old viewer result without be_relation must be rejected');

  const lists = await pageFor('https://space.bilibili.com/100/relation/follow', { listOnly: true, width: 800 });
  await lists.waitForFunction(() => __test.calls.some(url => url.startsWith('/x/web-interface/nav')));
  const identity = await lists.evaluate(async () => {
    const promise = fetch('https://api.bilibili.com/x/relation/followings?vmid=999');
    const same = promise === __test.lastOriginalPromise; const body = await promise.then(response => response.json()); return { same, code: body.code };
  });
  assert.deepEqual(identity, { same: true, code: 0 });
  await lists.waitForTimeout(200); assert.equal(await lists.locator(label).count(), 0, 'wrong list owner cannot label visible cards');
  await lists.evaluate(() => fetch('https://api.bilibili.com/x/relation/followings?vmid=100'));
  await waitCaption(lists, '你关注 Ta 于');
  await lists.evaluate(() => { history.pushState({}, '', '/100/relation/fans'); document.querySelector('.relation-card-info__uname').textContent = '粉丝'; });
  await lists.evaluate(() => new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('GET', 'https://api.bilibili.com/x/relation/fans?vmid=100'); xhr.onload = () => resolve(xhr.status); xhr.onerror = reject; xhr.send(); }));
  await waitCaption(lists, 'Ta 关注你于');
  await lists.evaluate(() => { history.pushState({}, '', '/200/relation/follow'); document.querySelector('.relation-card-info__uname').textContent = '别人的关注'; });
  await lists.evaluate(() => fetch('https://api.bilibili.com/x/relation/followings?vmid=200'));
  await waitCaption(lists, '主页主人关注 Ta 于');
  await lists.evaluate(() => { document.querySelector('.relation-card-info__uname').href = 'https://space.bilibili.com/555'; });
  await lists.waitForFunction(() => !document.querySelector('[data-brp-subscribe-time]'));

  // Newer nav response wins even if the older request finishes last.
  await lists.evaluate(() => { void fetch('https://api.bilibili.com/x/web-interface/nav?slow=1'); __test.viewer = '300'; });
  await lists.evaluate(() => fetch('https://api.bilibili.com/x/web-interface/nav'));
  await lists.evaluate(() => __test.resolve('nav'));
  await lists.evaluate(() => { history.pushState({}, '', '/300/relation/follow'); document.querySelector('.relation-card-info__uname').href = 'https://space.bilibili.com/333'; });
  await lists.evaluate(() => fetch('https://api.bilibili.com/x/relation/followings?vmid=300'));
  await waitCaption(lists, '你关注 Ta 于');

  // A pre-unfollow list response must not resurrect an invalidated timestamp.
  await lists.evaluate(() => { void fetch('https://api.bilibili.com/x/relation/followings?vmid=300&slow=1'); });
  await lists.evaluate(() => fetch('https://api.bilibili.com/x/relation/modify', { method: 'POST' }));
  await lists.waitForFunction(() => !document.querySelector('[data-brp-subscribe-time]'));
  await lists.evaluate(() => __test.resolve('list'));
  await lists.waitForTimeout(300); assert.equal(await lists.locator(label).count(), 0);

  const disabled = await pageFor('https://space.bilibili.com/222', { enabled: false });
  await disabled.waitForTimeout(300); assert.deepEqual(await disabled.evaluate(() => __test.calls), []);
  assert.equal(await disabled.locator(label).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: profile/nav queries, exact owner/direction, fetch+XHR, account/request races, mutation invalidation, disabled requests, SPA reuse, 360px action layout, original Promise, comments coexistence. All identities and responses were fixtures.');
} finally {
  await Promise.all(contexts.map(context => context.close())); await browser.close();
}
