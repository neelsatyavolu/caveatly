// End-to-end test for "Block element…" (element picker + custom rules).
// Loads dist/ into Chromium and serves local pages (via --host-resolver-rules).
// Headless Chromium can't click the native context menu, so the test does what
// the menu does: a real right-click (which the page script remembers), then the
// same startPicker call the menu handler makes, sent from an extension page.
//   npm run build && npm run test:custom-rules
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'screenshots');
const PORT = 8991; // 8973-8974 are taken by other suites
const SITE = 'picker-test.example';
const SUB = `news.${SITE}`;
const OTHER = 'other-test.example';

// The promo has an inline !important display, which only USER-origin CSS beats.
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width">
<title>picker test</title>
<style>body { font: 16px system-ui; margin: 24px; } .promo-banner { padding: 24px; background: #fde; }</style>
<main id="content"><h1>Article</h1><p class="lede">Article text that should stay.</p>
<div class="promo-banner css-1x9k2qz" data-testid="promo" style="display: block !important">
  <span class="promo-label">Sponsored offer</span></div>
<aside class="newsletter-box">Sign up</aside>
<p>More article text.</p></main>`;

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

const userDataDir = mkdtempSync(path.join(tmpdir(), 'caveatly-custom-rules-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${SUB} 127.0.0.1, MAP ${OTHER} 127.0.0.1, MAP analytics.n3el.dev ~NOTFOUND`,
  ],
});

const urlFor = host => `http://${host}:${PORT}/`;
const shown = (page, sel) => page.$eval(sel, el => getComputedStyle(el).display !== 'none');
const pickerOpen = page => page.evaluate(() => Boolean(document.querySelector('caveatly-picker')));

async function visit(page, host = SITE) {
  await page.goto(urlFor(host), { waitUntil: 'load' });
  await page.waitForTimeout(400); // USER CSS arrives after one worker round-trip
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extOrigin = `chrome-extension://${new URL(sw.url()).host}`;

  // Extension page standing in for the popup / settings UI.
  const ui = await context.newPage();
  await ui.goto(`${extOrigin}/popup.html`);
  const send = msg => ui.evaluate(m => chrome.runtime.sendMessage(m), msg);
  const stored = () => sw.evaluate(async () => (await chrome.storage.local.get('customRules')).customRules || []);

  const page = await context.newPage();
  await visit(page);
  const tabId = await sw.evaluate(async url => (await chrome.tabs.query({ url }))[0]?.id ?? null, `${urlFor(SITE)}*`);

  console.log('\n— context menu');
  const menuOk = await sw.evaluate(() => new Promise(resolve => {
    // Creating the same id again fails only if it already exists.
    chrome.contextMenus.create({ id: 'caveatly-block-element', title: 'x' }, () => {
      resolve(/duplicate/i.test(chrome.runtime.lastError?.message || ''));
    });
  }));
  check(menuOk, '"Block element…" context menu item registered');

  console.log('\n— picker: right-click, widen, preview, Esc');
  check(await shown(page, '.promo-banner'), 'promo visible before blocking');
  await page.click('.promo-label', { button: 'right' });
  check((await send({ type: 'customRules:startPicker', tabId, frameId: 0 }))?.ok, 'picker injected into the frame');
  check(await pickerOpen(page), 'picker panel shown');
  await page.keyboard.press('p');
  check(!(await shown(page, '.promo-label')) && (await shown(page, '.promo-banner')), 'starts on the right-clicked element (preview hides it)');
  await page.keyboard.press('ArrowUp');
  check(!(await shown(page, '.promo-banner')), 'ArrowUp widens to the parent');
  await page.keyboard.press('ArrowDown');
  check(await shown(page, '.promo-banner') && !(await shown(page, '.promo-label')), 'ArrowDown narrows back');
  await page.keyboard.press('Escape');
  check(!(await pickerOpen(page)), 'Esc closes the picker');
  check(await shown(page, '.promo-label'), 'Esc undoes the preview');
  check((await stored()).length === 0, 'nothing saved after cancel');

  console.log('\n— picker: hover and click another element');
  await send({ type: 'customRules:startPicker', tabId, frameId: 0 });
  const box = await page.locator('.newsletter-box').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.click(box.x + 5, box.y + 5);
  await page.keyboard.press('p');
  check(!(await shown(page, '.newsletter-box')) && (await shown(page, '.promo-banner')), 'click picks the hovered element');
  await page.keyboard.press('Escape');

  console.log('\n— screenshots');
  mkdirSync(SHOTS, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.click('.promo-label', { button: 'right' });
    await send({ type: 'customRules:startPicker', tabId, frameId: 0 });
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SHOTS, `picker-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log(`  saved ${path.join(SHOTS, 'picker-1280.png')} and picker-390.png`);

  console.log('\n— confirm saves a rule');
  await page.click('.promo-label', { button: 'right' });
  await send({ type: 'customRules:startPicker', tabId, frameId: 0 });
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const rules = await stored();
  check(rules.length === 1 && rules[0].site === SITE && typeof rules[0].id === 'string' && rules[0].createdAt > 0,
    `rule saved (${JSON.stringify(rules[0] ?? null)})`);
  check(!/css-1x9k2qz/.test(rules[0]?.selector || ''), 'selector skips the hashed class name');
  check(!(await pickerOpen(page)), 'picker closes after Block');
  check(!(await shown(page, '.promo-banner')), 'element hidden right away');

  console.log('\n— rule applies on reload, subdomains, and ignores ad-block switches');
  await sw.evaluate(site => chrome.storage.sync.set({ blockAds: false, pausedSites: [site] }), SITE);
  await visit(page);
  check(!(await shown(page, '.promo-banner')), 'hidden after reload (with Block ads off and site paused)');
  check(await shown(page, '.lede') && await shown(page, '.newsletter-box'), 'rest of the page still visible');
  const noStyleLeft = await page.evaluate(() => [...document.querySelectorAll('style')].every(s => !s.textContent.includes('display: none')));
  check(noStyleLeft, 'no <style> left in the page (USER CSS only)');
  await visit(page, SUB);
  check(!(await shown(page, '.promo-banner')), `applies on subdomain ${SUB}`);
  await visit(page, OTHER);
  check(await shown(page, '.promo-banner'), 'does not apply on another site');
  await sw.evaluate(() => chrome.storage.sync.set({ blockAds: true, pausedSites: [] }));

  console.log('\n— UI messages: list, remove, clear');
  const listed = await send({ type: 'customRules:list', site: SUB });
  check(listed?.ok && listed.rules.length === 1, 'list for a subdomain includes the parent-site rule');
  const otherList = await send({ type: 'customRules:list', site: OTHER });
  check(otherList?.ok && otherList.rules.length === 0, 'list for another site is empty');
  const removed = await send({ type: 'customRules:remove', id: rules[0]?.id });
  check(removed?.ok && removed.removed === 1, 'remove returns ok');
  await visit(page);
  check(await shown(page, '.promo-banner'), 'element visible again after remove + reload');

  await send({ type: 'customRules:startPicker', tabId, frameId: 0, target: '.newsletter-box' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check((await stored()).length === 1, 'picker started on a named target saves a rule');
  const cleared = await send({ type: 'customRules:clear', site: `www.${SITE}` });
  check(cleared?.ok && cleared.removed === 1 && (await stored()).length === 0, 'clear removes the site\'s rules');

  const forged = await page.evaluate(() => chrome.runtime?.sendMessage ? 'reachable' : 'unreachable');
  check(forged === 'unreachable', 'page scripts cannot message the extension');
} finally {
  await context.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall custom-rule checks passed');
process.exit(failures ? 1 : 0);
