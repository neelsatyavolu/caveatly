// End-to-end test for the extra filter lists (cookie notices, annoyances),
// element hiding inside about:blank/srcdoc ad frames, scriptlets (YouTube-style
// `##+js(...)` filters) and sponsored results on non-US Amazon/Google, Bing and
// DuckDuckGo. Loads dist/ into Chromium. Plain-http pages come from a local
// server (via --host-resolver-rules); https pages (YouTube, Amazon, Google, ...)
// are fulfilled by Playwright's request interception, so no real site, ad
// network or filter-list server is contacted.
//   npm run build && npm run test:adblock-lists
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { callsForHost, callsForEntity } from '../src/lib/scriptlet-match.js';
import { MAX_STATIC_RULES, MAX_REGEX_RULES } from '../src/lib/adblock-ids.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SITE = 'caveatly-lists.example';

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};
const readDist = file => JSON.parse(readFileSync(path.join(DIST, file), 'utf8'));

// ————— Static checks on the built data —————

console.log('— rule budget');
const manifest = readDist('manifest.json');
let totalRules = 0;
for (const { id, path: file } of manifest.declarative_net_request.rule_resources) {
  const rules = readDist(file);
  const regex = rules.filter(r => r.condition.regexFilter).length;
  totalRules += rules.length;
  check(regex < MAX_REGEX_RULES, `${id}: ${rules.length} rules, ${regex} regex`);
}
check(totalRules < MAX_STATIC_RULES, `all rulesets together: ${totalRules} < ${MAX_STATIC_RULES}`);

console.log('\n— scriptlet matching');
const adsScriptlets = readDist('filters/scriptlets-ads.json');
const fixture = {
  calls: [['setConstant', 'a', '1'], ['setConstant', 'b', '2'], ['setConstant', 'c', '3']],
  filters: [[0, []], [1, ['m.example.com']], [2, []]],
  domains: { 'example.com': [0, 1], 'shop.*': [2] },
  exceptions: { 'quiet.example.com': ['*'], 'no-a.example.com': [JSON.stringify(['setConstant', 'a', '1'])] },
};
const names = calls => calls.map(c => c[1]).join(',');
check(names(callsForHost(fixture, 'www.example.com')) === 'a,b', 'host and parent-domain filters apply');
check(names(callsForHost(fixture, 'm.example.com')) === 'a', '~domain exclusion is honoured');
check(names(callsForHost(fixture, 'quiet.example.com')) === '', '#@#+js() turns all scriptlets off');
check(names(callsForHost(fixture, 'no-a.example.com')) === 'b', '#@#+js(x) turns one scriptlet off');
check(names(callsForHost(fixture, 'example.org')) === '', 'other sites get nothing');
check(names(callsForEntity(fixture, 'www.shop.co.uk', 'www.shop')) === 'c', 'entity filter (shop.*) applies');
check(names(callsForEntity(fixture, 'shop.evil.com', 'shop.evil')) === '', 'entity needs the public suffix right after it');
const YT_CALL = ['setConstant', 'ytInitialPlayerResponse.adPlacements', 'undefined'];
const ytCalls = callsForHost(adsScriptlets, 'www.youtube.com');
check(ytCalls.some(c => JSON.stringify(c) === JSON.stringify(YT_CALL)), `YouTube has ${ytCalls.length} scriptlets, incl. ${YT_CALL.join(' ')}`);

// An entity-only setConstant filter from the real list, for the entity injection path.
function pickEntityFixture() {
  for (const [key, ids] of Object.entries(adsScriptlets.domains)) {
    if (!/^[a-z0-9-]+\.\*$/.test(key)) continue;
    const name = key.slice(0, -2);
    const host = `${name}.com`;
    if (callsForHost(adsScriptlets, host).length) continue;
    for (const id of ids) {
      const call = adsScriptlets.calls[adsScriptlets.filters[id][0]];
      if (call[0] === 'setConstant' && call.length === 3 && /^[a-zA-Z_]+$/.test(call[1]) && /^(true|false)$/.test(call[2])
        && callsForEntity(adsScriptlets, host, name).some(c => c === call)) {
        return { host, prop: call[1], value: call[2] === 'true' };
      }
    }
  }
  return null;
}
const entity = pickEntityFixture();
check(entity !== null, `entity fixture: ${entity && `${entity.host} sets ${entity.prop}=${entity.value}`}`);

// ————— Browser —————

// A request each new list blocks, chosen from the built rulesets so the test
// follows the lists as they change: a plain requestDomains block rule.
function blockedHost(file) {
  const rule = readDist(file).find(r => r.action.type === 'block' && r.condition.requestDomains
    && Object.keys(r.condition).length === 1);
  return rule?.condition.requestDomains[0];
}
const COOKIE_HOST = blockedHost('filters/cookies.json');
const ANNOYANCE_HOST = blockedHost('filters/annoyances.json');
check(Boolean(COOKIE_HOST && ANNOYANCE_HOST), `network fixtures: ${COOKIE_HOST}, ${ANNOYANCE_HOST}`);

const page = port => `<!doctype html><title>lists</title>
<div id="content">Article text</div>
<div class="ad-unit">AD</div>
<div class="gdpr-banner">We use cookies</div>
<div class="social-share">Share this</div>
<iframe id="srcdoc" srcdoc='<div class="ad-unit">AD</div><p id="ok">fine</p>'></iframe>
<iframe id="blank"></iframe>
<script>
  const doc = document.getElementById('blank').contentDocument;
  doc.open(); doc.write('<div class="ad-unit">AD</div><p id="ok">fine</p>'); doc.close();
</script>
<script src="http://${COOKIE_HOST}:${port}/cmp.js"></script>
<script src="http://${ANNOYANCE_HOST}:${port}/popup.js"></script>`;

const hits = [];
const server = createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  hits.push(host);
  res.writeHead(200, { 'content-type': host === SITE ? 'text/html' : 'text/javascript' });
  res.end(host === SITE ? page(PORT) : '');
});
// Any free port: other test runs may be using a fixed one.
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

const userDataDir = path.join(ROOT, '.pw-profile-adblock-lists');
rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${COOKIE_HOST} 127.0.0.1, MAP ${ANNOYANCE_HOST} 127.0.0.1, MAP analytics.n3el.dev ~NOTFOUND`,
  ],
});

// https pages, served from memory.
const HTTPS_PAGES = new Map();
await context.route(/^https:\/\//, route => {
  const page = HTTPS_PAGES.get(new URL(route.request().url()).hostname);
  if (!page) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, headers: { 'content-type': 'text/html', ...page.headers }, body: page.body });
});

const shown = (target, sel) => target.$eval(sel, el => getComputedStyle(el).display !== 'none');
const frameShown = (page, frameSel, sel) => page.$eval(frameSel, (f, s) => {
  const el = f.contentDocument?.querySelector(s);
  return el ? getComputedStyle(el).display !== 'none' : null;
}, sel);

async function visit(page) {
  hits.length = 0;
  await page.goto(`http://${SITE}:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500); // element hiding arrives after a worker round-trip
  return {
    cookieRequest: hits.includes(COOKIE_HOST),
    annoyanceRequest: hits.includes(ANNOYANCE_HOST),
    content: await shown(page, '#content'),
    ad: await shown(page, '.ad-unit'),
    cookie: await shown(page, '.gdpr-banner'),
    newsletter: await shown(page, '.social-share'),
    srcdocAd: await frameShown(page, '#srcdoc', '.ad-unit'),
    srcdocText: await frameShown(page, '#srcdoc', '#ok'),
    blankAd: await frameShown(page, '#blank', '.ad-unit'),
    blankText: await frameShown(page, '#blank', '#ok'),
  };
}

const settle = page => page.waitForTimeout(1200);

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const registered = async () => (await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())).map(s => s.id);
  for (let i = 0; i < 50 && !(await registered()).includes('caveatly-scriptlets-cookies'); i++) await new Promise(r => setTimeout(r, 200));
  const enabledRulesets = () => sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());

  console.log('\n— defaults (ads, trackers, cookie notices on; annoyances off)');
  let ids = await registered();
  check(['caveatly-cosmetics', 'caveatly-scriptlets-ads', 'caveatly-scriptlets-cookies'].every(id => ids.includes(id))
    && !ids.includes('caveatly-scriptlets-annoyances'), `content scripts: ${ids.join(', ')}`);
  let rulesets = await enabledRulesets();
  check(rulesets.includes('cookies') && !rulesets.includes('annoyances'), `rulesets: ${rulesets.join(', ')}`);
  const page = await context.newPage();
  let r = await visit(page);
  check(!r.cookieRequest, 'cookie-consent script blocked');
  check(r.annoyanceRequest, 'annoyance script allowed (list off)');
  check(!r.ad && !r.cookie, 'ad and cookie notice hidden');
  check(r.newsletter, 'social-share widget left alone (list off)');
  check(r.content, 'page content visible');

  console.log('\n— ad frames (about:blank and srcdoc)');
  check(r.srcdocAd === false && r.srcdocText === true, 'ad hidden inside a srcdoc iframe, its other content kept');
  check(r.blankAd === false && r.blankText === true, 'ad hidden inside a script-written about:blank iframe');

  console.log('\n— cookie notices on, ads off');
  await sw.evaluate(() => chrome.storage.sync.set({ blockAds: false }));
  await settle(page);
  r = await visit(page);
  check(r.ad, 'ad shown with "Block ads" off');
  check(!r.cookie && !r.cookieRequest, 'cookie notice still hidden and its script blocked');
  ids = await registered();
  check(ids.includes('caveatly-cosmetics') && !ids.includes('caveatly-scriptlets-ads'), 'element hiding stays, ad scriptlets go');

  console.log('\n— annoyances on');
  await sw.evaluate(() => chrome.storage.sync.set({ blockAds: true, blockAnnoyances: true }));
  await settle(page);
  rulesets = await enabledRulesets();
  check(rulesets.includes('annoyances'), `annoyances ruleset enabled (${rulesets.join(', ')})`);
  r = await visit(page);
  check(!r.newsletter && !r.annoyanceRequest, 'social-share widget hidden and annoyance script blocked');
  check(!r.cookie && !r.ad && r.content, 'cookie notice and ad still hidden, content visible');

  console.log('\n— cookie notices off');
  await sw.evaluate(() => chrome.storage.sync.set({ blockCookieNotices: false, blockAnnoyances: false }));
  await settle(page);
  rulesets = await enabledRulesets();
  check(!rulesets.includes('cookies') && !rulesets.includes('annoyances'), `cookie and annoyance rulesets off (${rulesets.join(', ')})`);
  r = await visit(page);
  check(r.cookie && r.cookieRequest, 'cookie notice and its script left alone');
  check(!r.ad, 'ads still hidden');

  console.log('\n— scriptlets (MAIN world, before page scripts, under a strict CSP)');
  // A YouTube-like page: its first inline script fills ytInitialPlayerResponse;
  // set-constant must already be in place to strip adPlacements.
  HTTPS_PAGES.set('www.youtube.com', {
    headers: { 'content-security-policy': "script-src 'nonce-t3st'; object-src 'none'" },
    body: `<!doctype html><html><head><script nonce="t3st">
      window.ytInitialPlayerResponse = { adPlacements: [{ ad: 1 }], videoDetails: { title: 'v' } };
      document.documentElement.dataset.result = JSON.stringify({
        adPlacements: window.ytInitialPlayerResponse.adPlacements === undefined ? 'stripped' : 'present',
        videoDetails: Boolean(window.ytInitialPlayerResponse.videoDetails),
      });
    </script></head><body>video</body></html>`,
  });
  const ytResult = async () => {
    await page.goto('https://www.youtube.com/watch?v=x', { waitUntil: 'load' });
    return JSON.parse(await page.evaluate(() => document.documentElement.dataset.result || '{}'));
  };
  let yt = await ytResult();
  check(yt.adPlacements === 'stripped', `adPlacements stripped before the page's first script (${yt.adPlacements})`);
  check(yt.videoDetails === true, 'the rest of the player response is untouched');
  await sw.evaluate(() => chrome.storage.sync.set({ blockAds: false }));
  await settle(page);
  yt = await ytResult();
  check(yt.adPlacements === 'present', 'scriptlets off with "Block ads" off');
  await sw.evaluate(() => chrome.storage.sync.set({ blockAds: true }));
  await settle(page);

  if (entity) {
    HTTPS_PAGES.set(entity.host, { headers: {}, body: '<!doctype html><title>entity</title><p>page</p>' });
    await page.goto(`https://${entity.host}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const value = await page.evaluate(prop => window[prop], entity.prop);
    check(value === entity.value, `entity filter injected by the worker on ${entity.host} (${entity.prop} = ${value})`);
  }

  console.log('\n— sponsored results beyond amazon.com / google.com');
  HTTPS_PAGES.set('www.amazon.de', {
    headers: {},
    body: `<!doctype html><div class="s-main-slot">
      <div class="s-result-item" id="ad"><span>Gesponsert</span><h2>Laufschuh</h2></div>
      <div class="s-result-item" id="organic"><h2>Gesponsert oder nicht: Laufschuh im Test</h2><span>4,5 Sterne</span></div>
    </div>`,
  });
  HTTPS_PAGES.set('www.google.co.uk', {
    headers: {},
    body: `<!doctype html><div id="tads"><div>text ad</div></div><div id="rso">
      <div id="ad"><span>Sponsored</span><a href="#">Shop</a></div>
      <div id="organic"><a href="#">Sponsored content rules explained</a></div>
    </div>`,
  });
  HTTPS_PAGES.set('www.bing.com', {
    headers: {},
    body: `<!doctype html><ol id="b_results"><li class="b_ad" id="ad">Ad</li><li class="b_algo" id="organic">Result</li></ol>`,
  });
  HTTPS_PAGES.set('duckduckgo.com', {
    headers: {},
    body: `<!doctype html><ol><li data-layout="ad" id="ad">Ad</li><li data-layout="organic" id="organic">Result</li></ol>`,
  });
  const serp = async (url, label) => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    check(!(await shown(page, '#ad')) && (await shown(page, '#organic')), `${label}: ad hidden, organic result kept`);
  };
  await serp('https://www.amazon.de/s?k=laufschuh', 'amazon.de ("Gesponsert")');
  await serp('https://www.google.co.uk/search?q=shoes', 'google.co.uk');
  check(!(await shown(page, '#tads')), 'google.co.uk: top text ads hidden');
  await serp('https://www.bing.com/search?q=shoes', 'bing.com');
  await serp('https://duckduckgo.com/?q=shoes', 'duckduckgo.com');
} finally {
  await context.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall filter-list checks passed');
process.exit(failures ? 1 : 0);
