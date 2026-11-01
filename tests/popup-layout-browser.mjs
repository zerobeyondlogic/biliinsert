import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// This opens actual toolbar action popups, not fixed-width extension tabs.
// Every Chromium profile is newly created. No user's cookies/profile are opened.
const workspace = process.cwd();
const artifacts = path.join(workspace, 'artifacts');
const scratch = await mkdtemp(path.join(tmpdir(), 'bili-popup-layout-'));
await mkdir(artifacts, { recursive: true });
const cached = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  || (existsSync(chromium.executablePath()) ? chromium.executablePath() : existsSync(cached) ? cached : undefined);
const fixedDirectory = path.join(workspace, 'dist');
const variants = [{ name: 'fixed', directory: fixedDirectory }];
const legacyArchive = path.join(artifacts, 'B站属地补全-0.2.0.zip');
if (existsSync(legacyArchive)) {
  const directory = path.join(scratch, 'legacy-extension');
  await cp(fixedDirectory, directory, { recursive: true });
  // Read exact archived popup assets; leave the user's source/dist untouched.
  execFileSync('tar', ['-xf', legacyArchive, '-C', directory,
    'manifest.json', 'popup.html', 'popup.css', 'popup.js', 'background.js'], { stdio: 'pipe' });
  variants.push({ name: 'legacy-0.2.0', directory });
}

function attachSession(cdp, sessionId) {
  let nextId = 0;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const finish = (error, value) => {
      clearTimeout(timeout); cdp.off('Target.receivedMessageFromTarget', listener);
      error ? reject(error) : resolve(value);
    };
    const listener = event => {
      if (event.sessionId !== sessionId) return;
      const result = JSON.parse(event.message);
      if (result.id !== id) return;
      finish(result.error ? new Error(JSON.stringify(result.error)) : null, result.result);
    };
    const timeout = setTimeout(() => finish(new Error(`Popup CDP timeout: ${method}`)), 10_000);
    cdp.on('Target.receivedMessageFromTarget', listener);
    void cdp.send('Target.sendMessageToTarget', {
      sessionId, message: JSON.stringify({ id, method, params }),
    }).catch(error => finish(error));
  });
}

async function openAndMeasure(worker, cdp, label) {
  // chrome.action.openPopup creates a real action popup browser view. Playwright
  // does not expose that view in context.pages(), so attach to its CDP target.
  await worker.evaluate(() => chrome.action.openPopup());
  const targets = await cdp.send('Target.getTargets');
  const extensionId = new URL(worker.url()).hostname;
  const target = targets.targetInfos.find(item => item.type === 'page'
    && item.url === `chrome-extension://${extensionId}/popup.html`);
  assert.ok(target, 'chrome.action.openPopup must create an inspectable popup target');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const send = attachSession(cdp, sessionId);
  const result = await send('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `new Promise(resolve => setTimeout(() => {
      const html=document.documentElement,body=document.body,title=document.querySelector('h1');
      const titleStyle=getComputedStyle(title),bodyStyle=getComputedStyle(body),rootStyle=getComputedStyle(html);
      const range=document.createRange();range.selectNodeContents(title);
      const titleRects=[...range.getClientRects()].map(rect=>({width:rect.width,height:rect.height,top:rect.top}));
      resolve({url:location.href,version:chrome.runtime.getManifest().version,innerWidth,innerHeight,outerWidth,outerHeight,
        dpr:devicePixelRatio,rootClientWidth:html.clientWidth,rootScrollWidth:html.scrollWidth,
        rootWidth:rootStyle.width,rootMinWidth:rootStyle.minWidth,bodyWidth:body.getBoundingClientRect().width,
        bodyMinWidth:bodyStyle.minWidth,titleHeight:title.getBoundingClientRect().height,
        titleLineHeight:parseFloat(titleStyle.lineHeight),titleRects,
        horizontalOverflow:html.scrollWidth>html.clientWidth+1,
        settingRows:[...document.querySelectorAll('.setting-row')].map(row=>({width:row.getBoundingClientRect().width,height:row.getBoundingClientRect().height}))});
    }, 350))`,
  });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  const measure = result.result.value;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(artifacts, `popup-native-${label}.png`);
  await writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  await cdp.send('Target.closeTarget', { targetId: target.targetId });
  return { ...measure, screenshot: path.relative(workspace, screenshot), nativeActionPopup: true };
}

const report = {
  testedAt: new Date().toISOString(), method: 'chrome.action.openPopup + CDP target attachment; viewport:null',
  freshProfilesOnly: true, profilesDirectory: scratch, results: [],
};
try {
  for (const variant of variants) for (const scale of (variant.name === 'fixed' ? [1, 1.5, 2] : [1.5])) {
    const profile = await mkdtemp(path.join(scratch, `${variant.name}-${scale}-`));
    const context = await chromium.launchPersistentContext(profile, {
      executablePath, headless: true, viewport: null,
      args: [`--disable-extensions-except=${variant.directory}`, `--load-extension=${variant.directory}`,
        '--window-size=1200,900', `--force-device-scale-factor=${scale}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const page = context.pages()[0] || await context.newPage();
      await page.goto('about:blank');
      const cdp = await context.newCDPSession(page);
      report.browser ||= await cdp.send('Browser.getVersion');
      const measured = await openAndMeasure(worker, cdp, `${variant.name}-scale-${scale}`);
      assert.ok(Math.abs(measured.dpr - scale) < 0.03, 'device scale factor must be applied by Chromium');
      report.results.push({ variant: variant.name, requestedDeviceScale: scale, requestedBrowserZoom: 1, ...measured });
      if (variant.name === 'fixed') {
        assert.ok(Math.abs(measured.bodyWidth - 360) <= 1, JSON.stringify(measured));
        assert.ok(measured.rootClientWidth >= 359 && measured.rootClientWidth <= 380, JSON.stringify(measured));
        assert.equal(measured.horizontalOverflow, false);
        assert.ok(measured.titleHeight < measured.titleLineHeight * 1.3, 'title must remain one line');
        assert.ok(measured.settingRows.every(row => row.width > 260 && row.height < 70), 'settings must remain horizontal');
      }

      // Try real Chromium tab-zoom storage for the extension origin. Record the
      // measured popup DPR separately: tab zoom is not necessarily inherited by
      // action popups, and must never be reported as tested popup zoom if it is not.
      if (variant.name === 'fixed' && scale === 1) {
        for (const zoom of [1.25]) {
          const applied = await worker.evaluate(async zoom => {
            const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: false });
            try {
              await chrome.tabs.setZoom(tab.id, zoom);
              return { readback: await chrome.tabs.getZoom(tab.id) };
            } catch (error) {
              return { error: error.message, settings: await chrome.tabs.getZoomSettings(tab.id) };
            } finally { await chrome.tabs.remove(tab.id); }
          }, zoom);
          if (applied.error) {
            report.browserZoomAttempt = { requestedZoom: zoom, ...applied, popupZoomVerified: false };
            report.browserZoomUnsupported = true;
            break;
          }
          const zoomMeasure = await openAndMeasure(worker, cdp, `fixed-tabzoom-${zoom}`);
          const inherited = Math.abs(zoomMeasure.dpr / scale - zoom) < 0.04;
          report.results.push({ variant: variant.name, requestedDeviceScale: scale,
            requestedBrowserZoom: zoom, verifiedTabZoom: applied.readback, popupInheritedTabZoom: inherited, ...zoomMeasure });
          assert.ok(Math.abs(zoomMeasure.bodyWidth - 360) <= 1);
          assert.equal(zoomMeasure.horizontalOverflow, false);
        }
      }
    } finally { await context.close(); }
  }
  report.legacyCollapsed = report.results.some(result => result.variant === 'legacy-0.2.0'
    && (result.bodyWidth < 300 || result.titleHeight > result.titleLineHeight * 1.5));
  report.fixedPassed = report.results.filter(result => result.variant === 'fixed').every(result =>
    Math.abs(result.bodyWidth - 360) <= 1 && !result.horizontalOverflow && result.titleHeight < result.titleLineHeight * 1.3);
  report.popupBrowserZoomVerified = report.results.filter(result => result.popupInheritedTabZoom).map(result => result.requestedBrowserZoom);
  await writeFile(path.join(artifacts, 'popup-layout-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fixedPassed: report.fixedPassed, legacyCollapsed: report.legacyCollapsed,
    nativePopupCases: report.results.length, popupBrowserZoomVerified: report.popupBrowserZoomVerified,
    browserZoomAttempt: report.browserZoomAttempt,
    results: report.results.map(({ variant, requestedDeviceScale, requestedBrowserZoom, popupInheritedTabZoom, bodyWidth, rootClientWidth, titleHeight, dpr }) =>
      ({ variant, scale: requestedDeviceScale, browserZoom: requestedBrowserZoom, popupInheritedTabZoom, bodyWidth, rootClientWidth, titleHeight, dpr })),
    report: 'artifacts/popup-layout-validation.json' }, null, 2));
} catch (error) {
  report.error = error.message;
  await writeFile(path.join(artifacts, 'popup-layout-validation.json'), JSON.stringify(report, null, 2));
  throw error;
}
