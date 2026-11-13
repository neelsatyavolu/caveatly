// End-to-end test for Chrome-level privacy settings (lib/browser-privacy.js).
// Loads dist/ into Chromium, reads chrome.privacy prefs from the service worker
// before and after toggling each setting, checks the ping DNR rule, and sends a
// real navigator.sendBeacon from a local page to see it blocked.
//   npm run build && npm run test:browser-privacy
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SITE = 'caveatly-privacy.example';
const PING_RULE_ID = 3001;

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};

const hits = [];
const server = createServer((req, res) => {
  hits.push(req.url);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>privacy test</title><p>hello</p>');
});
// Port 0: the OS picks a free port, so parallel test runs don't collide.
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

const userDataDir = path.join(ROOT, '.pw-profile-browser-privacy');
rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP analytics.n3el.dev ~NOTFOUND`,
  ],
});

const PREFS = [
  'websites.topicsEnabled', 'websites.fledgeEnabled', 'websites.adMeasurementEnabled',
  'websites.thirdPartyCookiesAllowed', 'network.webRTCIPHandlingPolicy', 'websites.hyperlinkAuditingEnabled',
  'services.alternateErrorPagesEnabled', 'services.safeBrowsingExtendedReportingEnabled',
  'services.spellingServiceEnabled', 'network.networkPredictionEnabled',
];

const readPrefs = sw => sw.evaluate(async names => {
  const out = {};
  for (const name of names) {
    const [ns, pref] = name.split('.');
    const setting = chrome.privacy?.[ns]?.[pref];
    out[name] = setting ? await setting.get({}) : null;
  }
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  out.pingRule = rules.find(r => r.id === 3001) || null;
  return out;
}, PREFS);

// Wait until a pref reaches the expected controller state after a storage change.
async function settle(sw, predicate) {
  for (let i = 0; i < 40; i++) {
    const prefs = await readPrefs(sw);
    if (predicate(prefs)) return prefs;
    await new Promise(r => setTimeout(r, 100));
  }
  return readPrefs(sw);
}

const ours = p => p?.levelOfControl === 'controlled_by_this_extension';
const exists = p => p !== null;
// Every pref in `names` that this Chromium has is (or is not) held by Caveatly.
const allOurs = (x, names, want = true) => names.every(n => !exists(x[n]) || ours(x[n]) === want);

async function beaconReached(page) {
  hits.length = 0;
  await page.goto(`http://${SITE}:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.sendBeacon('/beacon', 'x'));
  await page.waitForTimeout(800);
  return hits.includes('/beacon');
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;

  console.log('— defaults (disableAdApis, protectWebRtc, blockPings on; cookies and hardening off)');
  let p = await settle(sw, x => x.pingRule && allOurs(x, PREFS.slice(0, 3).concat(PREFS.slice(4, 6))));
  for (const name of ['websites.topicsEnabled', 'websites.fledgeEnabled', 'websites.adMeasurementEnabled']) {
    if (!exists(p[name])) { console.log(`    (skip: ${name} not in this Chromium)`); continue; }
    check(p[name].value === false && ours(p[name]), `${name} forced off`);
  }
  check(p['network.webRTCIPHandlingPolicy'].value === 'default_public_interface_only' && ours(p['network.webRTCIPHandlingPolicy']), 'WebRTC limited to public interface');
  check(p['websites.hyperlinkAuditingEnabled'].value === false && ours(p['websites.hyperlinkAuditingEnabled']), 'hyperlink auditing off');
  check(p.pingRule?.condition?.resourceTypes?.includes('ping') && p.pingRule.action.type === 'block', `ping block rule ${PING_RULE_ID} present`);
  check(!ours(p['websites.thirdPartyCookiesAllowed']), 'third-party cookies left to Chrome');
  for (const name of PREFS.slice(6)) {
    if (exists(p[name])) check(!ours(p[name]), `${name} left to Chrome`);
  }

  const page = await context.newPage();
  check(!(await beaconReached(page)), 'sendBeacon request blocked');

  console.log('\n— status message');
  // Ask from an extension page, as the popup/settings UI will.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/popup.html`);
  const status = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'browserPrivacy:status' }));
  await ext.close();
  check(status?.ok === true, 'browserPrivacy:status answers');
  const s = status?.status || {};
  check(s.protectWebRtc?.on && s.protectWebRtc.controllable && !s.protectWebRtc.controlledByOther, 'protectWebRtc reported on and controllable');
  check(s.blockPings?.on === true, 'blockPings reported on');
  check(s.blockThirdPartyCookies?.on === false && s.blockThirdPartyCookies.controllable, 'blockThirdPartyCookies reported off and controllable');
  check(s.hardenChromeServices?.on === false, 'hardenChromeServices reported off');
  const fromPage = await page.evaluate(() => typeof chrome !== 'undefined' && chrome.runtime?.sendMessage ? 'reachable' : 'no-runtime');
  check(fromPage === 'no-runtime', 'web pages cannot message the extension');

  console.log('\n— opt-in settings on');
  await sw.evaluate(() => chrome.storage.sync.set({ blockThirdPartyCookies: true, hardenChromeServices: true }));
  p = await settle(sw, x => allOurs(x, PREFS));
  check(p['websites.thirdPartyCookiesAllowed'].value === false && ours(p['websites.thirdPartyCookiesAllowed']), 'third-party cookies blocked');
  for (const name of PREFS.slice(6)) {
    if (!exists(p[name])) { console.log(`    (skip: ${name} not in this Chromium)`); continue; }
    check(p[name].value === false && ours(p[name]), `${name} forced off`);
  }

  console.log('\n— everything off (prefs cleared, rule removed)');
  await sw.evaluate(() => chrome.storage.sync.set({
    disableAdApis: false, blockThirdPartyCookies: false, protectWebRtc: false, blockPings: false, hardenChromeServices: false,
  }));
  p = await settle(sw, x => !x.pingRule && allOurs(x, PREFS, false));
  for (const name of PREFS) {
    if (exists(p[name])) check(!ours(p[name]), `${name} returned to Chrome (${p[name].levelOfControl}, value ${JSON.stringify(p[name].value)})`);
  }
  check(p['network.webRTCIPHandlingPolicy'].value !== 'default_public_interface_only', 'WebRTC policy back to default');
  check(!p.pingRule, 'ping block rule removed');
  check(await beaconReached(page), 'sendBeacon request allowed again');

  console.log('\n— back on');
  await sw.evaluate(() => chrome.storage.sync.set({ disableAdApis: true, protectWebRtc: true, blockPings: true }));
  p = await settle(sw, x => x.pingRule && allOurs(x, PREFS.slice(0, 3).concat(PREFS.slice(4, 6))));
  check(Boolean(p.pingRule) && ours(p['network.webRTCIPHandlingPolicy']) && ours(p['websites.hyperlinkAuditingEnabled']), 'settings re-applied after toggling back on');
  const other = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  check(!other.some(r => r.id !== PING_RULE_ID && r.id >= 3000 && r.id < 3100), 'no stray rules in the 3000-3099 range');
} finally {
  await context.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall browser-privacy checks passed');
process.exit(failures ? 1 : 0);
