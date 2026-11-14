// End-to-end test for ad and tracker blocking. Loads dist/ into Chromium and
// serves a local page whose ad, tracker and content requests all resolve to a
// local server (via --host-resolver-rules), so the server log shows what the
// extension let through. No real ad networks are contacted.
//   npm run build && npm run test:adblock
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const PORT = 8974;
const SITE = 'caveatly-test.example';
const AD_HOST = 'securepubads.g.doubleclick.net';  // EasyList
const TRACKER_HOST = 'cbdatatracker.com';           // EasyPrivacy (not HSTS-preloaded)
const CONTENT_HOST = 'cdn.caveatly-test.example';    // neither

const PAGE = `<!doctype html><title>test</title>
<div id="content">Article text</div>
<div class="ad-unit">AD</div>
<div class="sponsored-post">AD</div>
<script src="http://${AD_HOST}:${PORT}/tag/js/gpt.js"></script>
<script src="http://${TRACKER_HOST}:${PORT}/analytics.js"></script>
<script src="http://${CONTENT_HOST}:${PORT}/app.js"></script>`;

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};

const hits = [];
const server = createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  hits.push(host);
  if (host === SITE) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  } else {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end('');
  }
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

const userDataDir = path.join(ROOT, '.pw-profile-adblock');
rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${AD_HOST} 127.0.0.1, MAP ${TRACKER_HOST} 127.0.0.1, MAP ${CONTENT_HOST} 127.0.0.1, MAP analytics.n3el.dev ~NOTFOUND`,
  ],
});

async function visit(page) {
  hits.length = 0;
  await page.goto(`http://${SITE}:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500); // element hiding arrives after a worker round-trip
  const shown = sel => page.$eval(sel, el => getComputedStyle(el).display !== 'none');
  if (process.env.DEBUG) console.log('   hits:', [...hits]);
  return {
    ad: hits.includes(AD_HOST),
    tracker: hits.includes(TRACKER_HOST),
    content: hits.includes(CONTENT_HOST),
    adShown: await shown('.ad-unit'),
    sponsoredShown: await shown('.sponsored-post'),
    contentShown: await shown('#content'),
  };
}

const waitForRegistration = sw => sw.evaluate(async () => {
  for (let i = 0; i < 50; i++) {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    if (scripts.some(s => s.id === 'caveatly-cosmetics')) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  check(await waitForRegistration(sw), 'element-hiding content script registered');

  const enabled = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  check(['easylist', 'easyprivacy', 'reuters'].every(id => enabled.includes(id)), `rulesets enabled (${enabled.join(', ')})`);

  const page = await context.newPage();

  console.log('\n— blocking on (defaults)');
  let r = await visit(page);
  check(!r.ad, 'ad script blocked');
  check(!r.tracker, 'tracker script blocked');
  check(r.content, 'ordinary script still loads');
  check(!r.adShown && !r.sponsoredShown, 'ad elements hidden');
  check(r.contentShown, 'page content still visible');

  const tabId = await sw.evaluate(async site => {
    const [tab] = await chrome.tabs.query({ url: `http://${site}/*` });
    return tab?.id ?? null;
  }, `${SITE}:${PORT}`);
  const blocked = await sw.evaluate(async id => {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: id });
    return rulesMatchedInfo.length;
  }, tabId);
  check(blocked >= 2, `blocked requests counted for the tab (${blocked})`);

  console.log('\n— paused on this site');
  await sw.evaluate(site => chrome.storage.sync.set({ pausedSites: [site] }), SITE);
  await page.waitForTimeout(800);
  r = await visit(page);
  check(r.ad && r.tracker, 'ad and tracker requests allowed while paused');
  check(r.adShown, 'ad elements left alone while paused');

  console.log('\n— master switch off, then back on');
  await sw.evaluate(() => chrome.storage.sync.set({ pausedSites: [], adblockOn: false }));
  await page.waitForTimeout(800);
  r = await visit(page);
  check(r.ad && r.tracker, 'ad and tracker requests allowed with the ad blocker off');
  check(r.adShown, 'no element hiding with the ad blocker off');
  const keptLists = await sw.evaluate(() => chrome.storage.sync.get(['blockAds', 'blockTrackers']));
  check(keptLists.blockAds !== false && keptLists.blockTrackers !== false, 'list choices kept while the ad blocker is off');
  await sw.evaluate(() => chrome.storage.sync.set({ adblockOn: true }));
  await page.waitForTimeout(800);
  r = await visit(page);
  check(!r.ad && !r.tracker && !r.adShown, 'blocking back after turning the ad blocker on');

  console.log('\n— trackers only');
  await sw.evaluate(() => chrome.storage.sync.set({ pausedSites: [], blockAds: false, blockTrackers: true }));
  await page.waitForTimeout(800);
  r = await visit(page);
  check(r.ad, 'ad request allowed with "Block ads" off');
  check(!r.tracker, 'tracker still blocked with "Block trackers" on');
  check(r.adShown, 'no element hiding with "Block ads" off');

  console.log('\n— everything off');
  await sw.evaluate(() => chrome.storage.sync.set({ blockAds: false, blockTrackers: false, blockCookieNotices: false }));
  await page.waitForTimeout(800);
  r = await visit(page);
  check(r.ad && r.tracker && r.content, 'all requests allowed');
  const registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  check(!registered.some(s => s.id.startsWith('caveatly-')), 'ad-blocking content scripts unregistered');
} finally {
  await context.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall ad-blocking checks passed');
process.exit(failures ? 1 : 0);
