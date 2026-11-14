// End-to-end test for link cleaning. Loads dist/ into Chromium; the test site,
// the "destination" site and the wrapper hosts (www.google.com, href.li) all
// resolve to a local server (via --host-resolver-rules), so the server log shows
// exactly which URLs the browser requested. Nothing real is contacted.
//   npm run build && npm run test:link-cleaning
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const PORT = 8975;
const SITE = 'linkclean-test.example';
const DEST = 'dest.linkclean-test.example';
const GOOGLE = 'www.google.com';
const HREFLI = 'href.li';
const dest = p => `http://${DEST}:${PORT}${p}`;

const WRAPPED = `http://${GOOGLE}:${PORT}/url?q=${encodeURIComponent(dest('/landed?a=1&utm_source=x'))}&sa=D`;
const PAGE = `<!doctype html><title>links</title>
<a id="google" href="${WRAPPED}">wrapped</a>
<a id="hover" href="${WRAPPED}">wrapped (hover)</a>
<a id="utm" href="${dest('/plain?id=7&utm_campaign=y&fbclid=z')}">tagged</a>
<a id="login" href="${dest('/login?next=1&utm_source=x')}">sign in</a>`;

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};

const hits = [];
const server = createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  // Favicon fetches for the previous page can arrive after the log is cleared.
  if (req.url !== '/favicon.ico') hits.push({ host, url: req.url, gpc: req.headers['sec-gpc'] || null });
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(host === SITE ? PAGE : '<!doctype html><title>landed</title>');
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

const userDataDir = path.join(ROOT, '.pw-profile-linkclean');
rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${DEST} 127.0.0.1, MAP ${GOOGLE} 127.0.0.1, MAP ${HREFLI} 127.0.0.1, MAP analytics.n3el.dev ~NOTFOUND`,
  ],
});

async function waitForHit(predicate, ms = 5000) {
  for (let waited = 0; waited < ms; waited += 100) {
    const hit = hits.find(predicate);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

async function openSite(page) {
  await page.goto(`http://${SITE}:${PORT}/`, { waitUntil: 'load' });
  hits.length = 0;
}

async function clickAndLand(page, selector) {
  await openSite(page);
  await page.click(selector);
  const hit = await waitForHit(h => h.host === DEST);
  if (process.env.DEBUG) console.log('   hits:', hits);
  return hit;
}

const state = sw => sw.evaluate(async () => ({
  scripts: (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id),
  rules: (await chrome.declarativeNetRequest.getDynamicRules()).map(r => r.id),
}));

async function waitForState(sw, predicate) {
  for (let i = 0; i < 50; i++) {
    const s = await state(sw);
    if (predicate(s)) return s;
    await new Promise(r => setTimeout(r, 100));
  }
  return state(sw);
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await context.newPage();

  console.log('— defaults (unwrapLinks on, minimize on)');
  let s = await waitForState(sw, x => x.scripts.includes('linkclean-unwrap') && x.rules.includes(4110));
  check(s.rules.includes(1002), 'parameter stripping on by default');
  check(s.scripts.includes('linkclean-unwrap'), 'unwrap content script registered');
  check(s.rules.includes(4110), 'unwrap fallback rules installed');
  console.log('\n— minimize off');
  await sw.evaluate(() => chrome.storage.sync.set({ minimize: false }));
  s = await waitForState(sw, x => !x.rules.includes(1002));
  check(!s.rules.includes(1002), 'no parameter-stripping rule while minimize is off');

  let hit = await clickAndLand(page, '#google');
  check(hit?.url === '/landed?a=1', `google.com/url link went straight to the target, utm stripped (${hit?.url})`);
  check(!hits.some(h => h.host === GOOGLE), 'wrapper host never requested');

  await openSite(page);
  await page.hover('#hover');
  const hovered = await page.getAttribute('#hover', 'href');
  check(hovered === dest('/landed?a=1'), 'hovering a wrapped link shows the real destination');

  hit = await clickAndLand(page, '#utm');
  check(hit?.url === '/plain?id=7&utm_campaign=y&fbclid=z', 'plain tagged link untouched while minimize is off');

  console.log('\n— minimize on');
  await sw.evaluate(() => chrome.storage.sync.set({ minimize: true }));
  s = await waitForState(sw, x => x.rules.includes(1002));
  check(s.rules.includes(1002) && s.rules.includes(4100), 'parameter-stripping and sign-in guard rules installed');

  hit = await clickAndLand(page, '#utm');
  check(hit?.url === '/plain?id=7', `tracking params stripped from navigation (${hit?.url})`);

  hit = await clickAndLand(page, '#login');
  check(hit?.url === '/login?next=1&utm_source=x', 'sign-in URL left untouched');
  check(hit?.gpc === '1', 'GPC header still sent on the sign-in page');

  console.log('\n— wrapper opened directly (DNR fallback)');
  hits.length = 0;
  await page.goto(`http://${HREFLI}:${PORT}/?${dest('/hrefli')}`).catch(() => {});
  hit = await waitForHit(h => h.host === DEST);
  check(hit?.url === '/hrefli' && !hits.some(h => h.host === HREFLI), 'href.li redirect skipped');

  hits.length = 0;
  await page.goto(`http://${GOOGLE}:${PORT}/url?q=${dest('/gdirect')}&sa=D`).catch(() => {});
  hit = await waitForHit(h => h.host === DEST);
  check(hit?.url === '/gdirect', 'google.com/url with an unencoded target skipped');

  console.log('\n— ad blocking toggles keep the unwrap script');
  await sw.evaluate(() => chrome.storage.sync.set({ blockAds: false }));
  await new Promise(r => setTimeout(r, 800));
  s = await state(sw);
  check(s.scripts.includes('linkclean-unwrap'), 'unwrap script survives the ad-blocking script resync');

  console.log('\n— unwrapLinks off');
  await sw.evaluate(() => chrome.storage.sync.set({ unwrapLinks: false, minimize: false }));
  s = await waitForState(sw, x => !x.scripts.includes('linkclean-unwrap') && !x.rules.includes(1002));
  check(!s.scripts.includes('linkclean-unwrap'), 'unwrap content script unregistered');
  check(![1002, 4100, 4110].some(id => s.rules.includes(id)), 'link-cleaning rules removed');
  await openSite(page);
  await page.hover('#hover');
  await page.dispatchEvent('#hover', 'pointerdown');
  check(await page.getAttribute('#hover', 'href') === WRAPPED, 'wrapped link left alone');
} finally {
  await context.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall link-cleaning checks passed');
process.exit(failures ? 1 : 0);
