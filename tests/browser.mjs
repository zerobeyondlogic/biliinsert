import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {bytesField,concat,grpcFrame,intField,stringField,requestBody} from '../src/dynamic-protocol.js';

const samples = [ ['111','11','上海'], ['222','22','广东'], ['333','33',null], ['444','44','浙江'], ['555','55','北京'] ];
const fixtures = samples.flatMap(([id,mid,region]) => ['DynDetail','OpusDetail'].map(method => {
  const isOpus = method === 'OpusDetail';
  const author = concat(intField(1,BigInt(mid)), ...(region ? [stringField(14,`IP属地：${region}`)] : []));
  const item = concat(...(isOpus ? [intField(1,BigInt(id))] : []),bytesField(isOpus?4:3,bytesField(2,author)),bytesField(isOpus?5:4,stringField(1,id)));
  return {id,request:[...requestBody(method,id)].join(','),response:[...grpcFrame(bytesField(1,item))]};
}));
await mkdir('artifacts', {recursive:true});
const profile = await mkdtemp(path.join(tmpdir(),'bili-region-test-'));
const cached = path.join(process.env.LOCALAPPDATA||'', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(chromium.executablePath()) ? undefined : existsSync(cached) ? cached : undefined);
const context = await chromium.launchPersistentContext(profile, {
  executablePath,headless:true,channel:executablePath?undefined:'chromium',viewport:{width:1100,height:900},
  args:[`--disable-extensions-except=${path.resolve('dist')}`,`--load-extension=${path.resolve('dist')}`]
});
const errors=[];
context.setDefaultTimeout(15000);
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).hostname;
  await worker.evaluate(async fixtures => {
    globalThis.fixtureCalls=[];
    globalThis.fetch=async (url, init={}) => {
      const parsed=new URL(url);globalThis.fixtureCalls.push(parsed.pathname);
      if(parsed.hostname==='app.bilibili.com'&&parsed.pathname==='/x/v2/space') {
        const mid=parsed.searchParams.get('vmid');
        return new Response(JSON.stringify({code:0,data:{card:{mid,space_tag:[{type:'location',title:mid==='2'?'IP属地：吉林':'IP属地：福建'}]}}}),{headers:{'content-type':'application/json'}});
      }
      const fixture=fixtures.find(f=>f.request===[...init.body].join(','));
      if(!fixture) throw new Error('Unexpected fixture request');
      if(fixture.id==='444') await new Promise(resolve=>setTimeout(resolve,1200));
      return new Response(Uint8Array.from(fixture.response),{headers:{'grpc-status':'0'}});
    };
    await chrome.storage.local.set({biliIpCredential:{accessToken:'fixture-only-access-token',deviceId:'fixture-device-id',expiresAt:Date.now()+86400000}});
  },fixtures);
  const page=await context.newPage();page.on('pageerror', e=>errors.push(e.message));
  await page.route('https://space.bilibili.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:60px auto;max-width:850px;background:#f6f7f8;color:#222;font:16px system-ui}header,article{background:#fff;border-radius:12px;padding:28px;margin-bottom:18px}.upinfo-detail__top{font-size:24px;font-weight:600}.bili-dyn-time,.bili-dyn-content__orig__author{color:#888;font-size:13px}.original{background:#f7f8fa;padding:20px;margin-top:20px}.note{color:#999;font-size:12px}</style><body><p class="note">自动化测试页面 · 以下属地来自测试数据，非真实用户数据</p><header><div class="upinfo-detail__top">测试主页</div></header><article class="bili-dyn-item" id="forward"><h3>转发动态</h3><span class="bili-dyn-time">今天 12:30</span><p>这里是转发者的动态内容</p><div class="original"><div class="bili-dyn-content__orig__author">原动态作者</div><p>原动态拥有独立的属地</p></div></article><article class="bili-dyn-item" id="empty"><h3>未返回属地</h3><span class="bili-dyn-time">昨天 18:00</span><p>不使用主页属地填充这里</p></article><script>const item=(id,mid)=>({id_str:id,modules:{module_author:{mid}}});document.querySelector('#forward').__vueParentComponent={props:{data:{...item('111','11'),orig:item('222','22')}}};document.querySelector('#empty').__vueParentComponent={props:{data:item('333','33')}};</script></body></html>`}));
  await page.goto('https://space.bilibili.com/2/dynamic');
  await page.waitForFunction(()=>document.querySelectorAll('.brp-label').length===3);
  assert.equal(await page.locator('[data-brp-kind="profile"]').innerText(),'IP属地：吉林');
  assert.equal(await page.locator('#forward > .brp-label').innerText(),'IP属地：上海');
  assert.equal(await page.locator('.original .brp-label').innerText(),'IP属地：广东');
  assert.equal(await page.locator('#empty .brp-label').count(),0);
  const nativeStyles = await page.locator('#forward > .brp-label').evaluate(label => {
    const style = getComputedStyle(label), time = getComputedStyle(label.previousElementSibling);
    return {background:style.backgroundColor,radius:style.borderRadius,padding:style.padding,color:style.color,timeColor:time.color,fontSize:style.fontSize,timeSize:time.fontSize};
  });
  assert.equal(nativeStyles.background, 'rgba(0, 0, 0, 0)');
  assert.equal(nativeStyles.radius, '0px');
  assert.equal(nativeStyles.padding, '0px');
  assert.equal(nativeStyles.color, nativeStyles.timeColor);
  assert.equal(nativeStyles.fontSize, nativeStyles.timeSize);
  await page.screenshot({path:'artifacts/fixture-preview.png',fullPage:true});
  await page.addStyleTag({content:'body{background:#17181a;color:#e1e2e3}header,article{background:#17181a;border:1px solid #303134}.original{background:#202123}.bili-dyn-time,.bili-dyn-content__orig__author{color:#7b8087}'});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#forward > .brp-label')).color===getComputedStyle(document.querySelector('#forward .bili-dyn-time')).color);
  await page.screenshot({path:'artifacts/native-dark-preview.png',fullPage:true});
  // Reused Vue card: an old response must never label the new content.
  await page.evaluate(()=>{
    const node=document.querySelector('#empty');node.__vueParentComponent.props.data={id_str:'444',modules:{module_author:{mid:'44'}}};node.querySelector('.bili-dyn-time').textContent='刚刚';
  });
  await page.waitForFunction(()=>document.querySelector('#empty .bili-dyn-time').getAttribute('data-brp-binding')?.includes('444'));
  await page.evaluate(()=>{const node=document.querySelector('#empty');node.__vueParentComponent.props.data={id_str:'555',modules:{module_author:{mid:'55'}}};node.querySelector('.bili-dyn-time').textContent='1 秒前';});
  await page.waitForFunction(()=>document.querySelector('#empty .brp-label')?.textContent==='IP属地：北京');
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('#empty .brp-label').innerText(),'IP属地：北京');
  await page.evaluate(()=>history.pushState({},'', '/3/dynamic'));
  await page.waitForFunction(()=>document.querySelector('[data-brp-kind="profile"]')?.textContent==='IP属地：福建');
  await worker.evaluate(()=>chrome.storage.sync.set({settings:{profile:false,dynamic:false}}));
  await page.waitForFunction(()=>document.querySelectorAll('.brp-label').length===0);
  await worker.evaluate(()=>chrome.storage.sync.set({settings:{profile:true,dynamic:true}}));
  await page.waitForFunction(()=>document.querySelectorAll('.brp-label').length===4);
  const popup=await context.newPage();popup.on('pageerror',e=>errors.push(e.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForFunction(()=>document.querySelector('#auth-state')?.textContent==='已授权');
  await popup.setViewportSize({width:400,height:820});
  await popup.screenshot({path:'artifacts/settings-preview.png',fullPage:true});
  await popup.locator('#clear-button').click();
  await page.bringToFront();
  await page.waitForFunction(()=>document.querySelectorAll('.brp-label').length===0);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('浏览器联调通过：真实扩展加载、主页、转发隔离、空属地、节点复用、SPA、开关、清除授权。API 使用模拟数据。');
} finally { await context.close(); }
