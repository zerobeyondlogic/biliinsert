// Optional public-network smoke test. Uses a fresh browser profile, no user cookies.
// Generates an official QR login challenge, but does not scan or confirm it.
import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {existsSync} from 'node:fs';
const cached=path.join(process.env.LOCALAPPDATA||'','ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(chromium.executablePath())?undefined:existsSync(cached)?cached:undefined);
const context=await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(),'bili-region-live-')),{
  executablePath,headless:true,channel:executablePath?undefined:'chromium',
  args:[`--disable-extensions-except=${path.resolve('dist')}`,`--load-extension=${path.resolve('dist')}`]
});
context.setDefaultTimeout(20000);
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).hostname;
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html?authorize=1`);
  await page.waitForFunction(()=>!document.querySelector('#qr-panel').hidden||(!document.querySelector('#message').hidden&&document.querySelector('#message').dataset.tone==='error'));
  const visible=await page.locator('#qr-panel').isVisible();
  if(!visible) throw new Error(await page.locator('#message').innerText());
  await page.waitForTimeout(4500);
  console.log('真实扩展网络检查：官方二维码生成成功；'+await page.locator('#qr-status').innerText());
  await page.locator('#cancel-button').click();
  const state=await page.evaluate(()=>chrome.runtime.sendMessage({type:'AUTH_STATUS'}));
  if(state.authorized) throw new Error('Unexpected authorization in clean test profile');
  console.log('未扫码、未登录，未读取用户浏览器会话。授权后属地仍待实站验收。');
} finally {await context.close();}
