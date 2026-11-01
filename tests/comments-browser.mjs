import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

const profile = await mkdtemp(path.join(tmpdir(), 'bili-comments-test-'));
const cached = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chromium.executablePath()) ? undefined : existsSync(cached) ? cached : undefined);
const context = await chromium.launchPersistentContext(profile, {
  executablePath, headless:true, channel:executablePath ? undefined : 'chromium', viewport:{width:1100,height:900},
  args:[`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`],
});
context.setDefaultTimeout(12000);
const errors = [];
const payload = {code:0,data:{replies:[
  {rpid_str:'3001',oid_str:'99',reply_control:{location:'IP属地：浙江'},replies:[{rpid_str:'3002',oid_str:'99',reply_control:{location:'IP属地：广东'}}]},
  {rpid_str:'3003',oid_str:'99',reply_control:{location:'IP属地：四川'}},
]}};
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>评论属地测试</title><style>
body{margin:48px auto;width:900px;background:#141414;color:#e3e5e7;font:15px system-ui,"Microsoft YaHei",sans-serif}
h1{font-size:24px}p.note{color:#9499a0;font-size:12px}section{padding:24px;border-bottom:1px solid #343539}.reply-info,.sub-reply-info,.info{font-size:13px;color:#9499a0;margin-top:12px}.reply-time,.sub-reply-time,.time{font-size:13px;color:#9499a0}.sub-reply-item{margin:18px 0 0 40px}.who{color:#fb7299;font-weight:600}.body{margin:12px 0;color:#e3e5e7}#legacy-fixtures{margin-top:30px}
</style><body><h1>评论与楼中楼 · IP 属地</h1><p class="note">自动化测试页面，地区来自模拟数据；用于验证扩展渲染，不代表真实 B 站用户信息。</p>
<bili-comments id="lit-root"></bili-comments><div id="legacy-fixtures">
<section class="reply-item" data-id="3001" data-oid="99" id="fetch-top"><div class="who">接口主评论</div><div class="body">主评论和楼中楼的地区分别展示。</div><div class="reply-info"><span class="reply-time">昨天 18:30</span><span>　回复</span></div><div class="sub-reply-list"><div class="sub-reply-item" data-id="3002" data-oid="99" id="fetch-sub"><div class="who">接口楼中楼</div><div class="body">不会使用主评论的属地。</div><div class="sub-reply-info"><span class="sub-reply-time">昨天 18:32</span><span>　回复</span></div></div></div></section>
<section class="reply-item" id="vue-top"><div class="who">Vue 评论</div><div class="reply-info"><span class="reply-time">今天 12:00</span><span>　回复</span></div><div class="sub-reply-list"><div class="sub-reply-item" id="vue-sub"><div class="who">Vue 楼中楼</div><div class="sub-reply-info"><span class="sub-reply-time">今天 12:01</span></div></div></div></section>
<section class="reply-item" data-id="3003" id="inline-native"><div class="reply-info"><span class="reply-time">今天 12:00　IP属地：四川</span></div></section>
<div id="old-output"></div><section class="reply-item" data-id="4001" id="xhr-top"><div class="who">XHR 评论</div><div class="reply-info"><span class="reply-time">昨天</span></div></section>
</div><script>
window.reply=(id,location,oid='99')=>({rpid_str:id,oid_str:oid,reply_control:{location}});
class Actions extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this.shadowRoot.innerHTML='<style>:host{display:block;color:#9499a0;font:13px system-ui}#pubdate{display:inline-block;color:#9499a0;font:13px system-ui}button{border:0;background:none;color:#9499a0;margin-left:16px}</style><span id="pubdate">昨天 22:42</span><button>回复</button>';}
 update(){this.nativeUpdates=(this.nativeUpdates||0)+1;return 'native-lifecycle-result';}
}
customElements.define('bili-comment-action-buttons-renderer',Actions);
class Thread extends HTMLElement {constructor(){super();this.attachShadow({mode:'open'});}}
customElements.define('bili-comment-thread-renderer',Thread);
class Comments extends HTMLElement {constructor(){super();this.attachShadow({mode:'open'});}}
customElements.define('bili-comments',Comments);
const root=document.querySelector('#lit-root').shadowRoot;
root.innerHTML='<style>section{padding:24px;border-bottom:1px solid #343539}.who{color:#fb7299;font-weight:600}.body{margin:12px 0}.sub{margin:22px 0 0 40px}</style><section><div class="who">主楼用户</div><div class="body">这个功能在手机上能看到，网页上也补全显示。</div><bili-comment-action-buttons-renderer id="top"></bili-comment-action-buttons-renderer><div class="sub"><bili-comment-thread-renderer id="thread"></bili-comment-thread-renderer></div></section><section><div class="who">已有属地的评论</div><bili-comment-action-buttons-renderer id="native"></bili-comment-action-buttons-renderer></section>';
const topReply=root.querySelector('#top');topReply.data=reply('1001','IP属地：上海');window.nativeUpdateReturn=topReply.update();
const thread=root.querySelector('#thread').shadowRoot;thread.innerHTML='<style>.who{color:#00aeec;font-weight:600}.body{margin:12px 0}</style><div class="who">楼中楼用户</div><div class="body">支持，回复也需要显示各自的属地。</div><bili-comment-action-buttons-renderer id="sub"></bili-comment-action-buttons-renderer>';
const sub=thread.querySelector('#sub');sub.data=reply('1002','IP属地：广东');sub.update();
const native=root.querySelector('#native');native.data=reply('1003','IP属地：河南');const already=document.createElement('span');already.id='location';already.textContent='IP属地：河南';native.shadowRoot.querySelector('#pubdate').after(already);native.update();
document.querySelector('#vue-top').__vueParentComponent={props:{reply:reply('5001','IP属地：北京')}};
document.querySelector('#vue-sub').__vueParentComponent={props:{subReply:reply('5002','IP属地：山东')}};
window.bbComment=function(){};bbComment.prototype._createListCon=function(value){return '<section class="list-item" data-id="'+value.rpid_str+'" id="old-main"><div class="info"><span class="time">今天 13:00</span></div></section>';};
bbComment.prototype._createSubReplyItem=function(value){return '<div class="reply-wrap" data-id="'+value.rpid_str+'" id="old-sub"><div class="info"><span class="time">今天 13:01</span></div></div>';};
// Methods assigned after constructor creation are discovered by the bounded compatibility scan.
window.loadOld=()=>{const old=new bbComment();const value=old._createListCon(reply('6001','IP属地：安徽'));window.oldHtml=value;document.querySelector('#old-output').innerHTML=value+old._createSubReplyItem(reply('6002','IP属地：河北'));};
window.loadFetch=async()=>{const response=await fetch('https://api.bilibili.com/x/v2/reply/wbi/main?oid=99');window.fetchBody=await response.json();};
window.loadXHR=()=>new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open('GET','https://api.bilibili.com/x/v2/reply/reply?oid=99');xhr.responseType='json';xhr.onload=()=>{window.xhrBody=xhr.response;resolve();};xhr.send();});
loadFetch();loadXHR();
</script></body></html>`;

try {
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await chrome.storage.local.clear();await chrome.storage.sync.set({settings:{profile:false,dynamic:false,comments:true}});});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://www.bilibili.com/video/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('https://api.bilibili.com/x/v2/reply/**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.bilibili.com'},body:JSON.stringify(route.request().url().includes('/reply/reply') ? {code:0,data:{replies:[{rpid_str:'4001',oid:'99',reply_control:{location:'IP属地：江苏'}}]}} : payload)}));
  await page.goto('https://www.bilibili.com/video/BVfixture');
  const owned='[data-brp-comment-location]';
  await page.waitForFunction(()=>document.querySelector('#fetch-top .reply-info [data-brp-comment-location]')?.textContent==='IP属地：浙江');
  await page.waitForFunction(()=>document.querySelector('#vue-sub [data-brp-comment-location]')?.textContent==='IP属地：山东');
  assert.equal(await page.locator('#lit-root #top').locator(owned).innerText(),'IP属地：上海');
  assert.equal(await page.locator('#lit-root #sub').locator(owned).innerText(),'IP属地：广东');
  assert.equal(await page.locator('#fetch-sub').locator(owned).innerText(),'IP属地：广东');
  assert.equal(await page.locator('#xhr-top').locator(owned).innerText(),'IP属地：江苏');
  assert.equal(await page.locator('#native').locator(owned).count(),0);
  assert.equal(await page.locator('#inline-native').locator(owned).count(),0);
  assert.equal(await page.evaluate(()=>window.nativeUpdateReturn),'native-lifecycle-result');
  assert.equal(await page.evaluate(()=>window.fetchBody.data.replies[0].rpid_str),'3001');
  assert.equal(await page.evaluate(()=>window.xhrBody.data.replies[0].rpid_str),'4001');
  const styling=await page.locator('#lit-root #top').locator(owned).evaluate(label=>{const a=getComputedStyle(label),b=getComputedStyle(label.previousElementSibling);return {background:a.backgroundColor,radius:a.borderRadius,font:a.fontSize,timeFont:b.fontSize,color:a.color,timeColor:b.color};});
  assert.equal(styling.background,'rgba(0, 0, 0, 0)');assert.equal(styling.radius,'0px');assert.equal(styling.font,styling.timeFont);assert.equal(styling.color,styling.timeColor);
  await page.waitForTimeout(2600);await page.evaluate(()=>window.loadOld());
  await page.waitForFunction(()=>document.querySelector('#old-sub [data-brp-comment-location]')?.textContent==='IP属地：河北');
  assert.equal(await page.locator('#old-main').locator(owned).innerText(),'IP属地：安徽');
  assert.equal((await page.evaluate(()=>window.oldHtml)).includes('brp-comment'),false);
  await page.evaluate(()=>window.loadFetch());
  assert.equal(await page.locator('#fetch-top > .reply-info').locator(owned).count(),1);
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/comments-dark-preview.png',fullPage:true});

  // Reusing a Lit instance or legacy node must remove the previous reply's location.
  await page.evaluate(()=>{const top=document.querySelector('#lit-root').shadowRoot.querySelector('#top');top.data=reply('1004','');top.update();document.querySelector('#fetch-top').setAttribute('data-id','3999');});
  await page.waitForFunction(()=>!document.querySelector('#fetch-top > .reply-info [data-brp-comment-location]'));
  assert.equal(await page.locator('#lit-root #top').locator(owned).count(),0);
  await page.evaluate(()=>{const top=document.querySelector('#lit-root').shadowRoot.querySelector('#top');top.data=reply('1005','IP属地：福建');top.update();});
  await page.waitForFunction(()=>document.querySelector('#lit-root').shadowRoot.querySelector('#top').shadowRoot.querySelector('[data-brp-comment-location]')?.textContent==='IP属地：福建');

  // Turning off is durable across updates, newly mounted trees and pagination.
  await worker.evaluate(()=>chrome.storage.sync.set({settings:{profile:false,dynamic:false,comments:false}}));
  await page.waitForFunction(()=>[...document.querySelectorAll('*')].filter(el=>el.shadowRoot).every(el=>!el.shadowRoot.querySelector('[data-brp-comment-location]')) && !document.querySelector('[data-brp-comment-location]'));
  await page.evaluate(()=>{const top=document.querySelector('#lit-root').shadowRoot.querySelector('#top');top.data=reply('1006','IP属地：辽宁');top.update();window.loadFetch();document.querySelector('#fetch-top').setAttribute('data-id','3001');history.pushState({},'', '/video/BVfixture?p=2');});
  await page.waitForTimeout(2800);assert.equal(await page.locator(owned).count(),0);
  await worker.evaluate(()=>chrome.storage.sync.set({settings:{profile:false,dynamic:false,comments:true}}));
  await page.waitForFunction(()=>document.querySelector('#fetch-top > .reply-info [data-brp-comment-location]')?.textContent==='IP属地：浙江');
  assert.equal(await page.locator('#lit-root #top').locator(owned).innerText(),'IP属地：辽宁');
  // No token was ever stored; clearing authorization must leave public comment labels intact.
  await worker.evaluate(async()=>{await chrome.storage.local.clear();const tabs=await chrome.tabs.query({url:'https://www.bilibili.com/*'});await Promise.all(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'AUTH_CHANGED'})));});
  await page.waitForTimeout(200);assert.equal(await page.locator('#lit-root #top').locator(owned).innerText(),'IP属地：辽宁');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('评论浏览器联调通过：真实扩展 MAIN/ISOLATED 注入、无授权、Lit嵌套Shadow DOM、主楼/楼中楼、Vue、bbComment、fetch/XHR原响应、去重、复用、开关与授权独立、暗色普通灰字。数据为模拟数据。');
} catch (error) {
  const page=context.pages().find(page=>page.url().includes('BVfixture'));
  if(page) console.error('Comment fixture failure:',JSON.stringify(await page.evaluate(()=>({html:document.querySelector('#fetch-top')?.innerHTML,fetchBody:window.fetchBody,xhrBody:window.xhrBody,hook:String(window.fetch),lit:document.querySelector('#lit-root')?.shadowRoot?.innerHTML}))),errors);
  throw error;
} finally { await context.close(); }
