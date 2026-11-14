// Embedded-build test: copies dist/ with "caveatly_embed": { telemetry: false,
// blocker: false } in manifest.json (what a host like Perch writes at packaging)
// and checks Caveatly is the fine-print grader only: no blocking, no privacy
// changes, no usage ping, and no blocker or usage-stats settings in the UI.
// A plain dist/ run alongside shows the same checks flip back.
//   npm run build && npm run test:embed
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SITE = 'embed-test.example';
const AD_HOST = 'securepubads.g.doubleclick.net';
const PAGE = `<!doctype html><title>t</title><div class="ad-unit">AD</div>
<script src="http://${AD_HOST}:PORT/gpt.js"></script>`;

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};

const hits = [];
const server = createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  hits.push(host);
  res.writeHead(200, { 'content-type': host === SITE ? 'text/html' : 'text/javascript' });
  res.end(host === SITE ? PAGE.replace('PORT', String(server.address().port)) : '');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

function embeddedCopy(embed = { telemetry: false, blocker: false }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'caveatly-embed-'));
  cpSync(DIST, dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, caveatly_embed: embed }));
  return dir;
}

async function launch(extDir) {
  const profile = mkdtempSync(path.join(tmpdir(), 'caveatly-embed-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${AD_HOST} 127.0.0.1, MAP analytics.n3el.dev ~NOTFOUND`,
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2500)); // onInstalled work: rulesets, scripts, privacy prefs
  return { context, sw, profile };
}

async function inspect({ context, sw }) {
  const state = await sw.evaluate(async () => ({
    rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
    dynamicRules: (await chrome.declarativeNetRequest.getDynamicRules()).map(r => r.id),
    scripts: (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id),
    webrtc: (await chrome.privacy.network.webRTCIPHandlingPolicy.get({})).levelOfControl,
    heartbeatDay: (await chrome.storage.local.get('heartbeatDay')).heartbeatDay || null,
    extId: chrome.runtime.id,
  }));
  const page = await context.newPage();
  hits.length = 0;
  await page.goto(`http://${SITE}:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  state.adRequested = hits.includes(AD_HOST);
  state.adShown = await page.$eval('.ad-unit', el => getComputedStyle(el).display !== 'none');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${state.extId}/popup.html`);
  await popup.waitForTimeout(1200);
  state.pickButton = await popup.getByLabel('Block an element on this page').count();
  state.adFooter = await popup.getByText(/blocked|Blocking ads|Ad blocker/).count();
  await popup.getByLabel('Settings').click();
  await popup.waitForTimeout(400);
  state.labels = await popup.$$eval('label, [role="switch"]', els => els.map(e => e.textContent.trim()));
  state.headings = await popup.$$eval('h2', els => els.map(e => e.textContent.trim().toLowerCase()));
  return state;
}

const embedDir = embeddedCopy();
const hideDir = embeddedCopy({ telemetry: false, hide: ['gpc', 'cookieGuard'] });
try {
  console.log('— embedded build (telemetry:false, blocker:false)');
  const embedded = await launch(embedDir);
  const e = await inspect(embedded);
  await embedded.context.close();
  rmSync(embedded.profile, { recursive: true, force: true });
  check(e.rulesets.length === 0, `no static rulesets enabled (${e.rulesets.join(', ') || 'none'})`);
  check(e.dynamicRules.length === 0, `no dynamic rules: GPC, link cleaning, pings, pause (${e.dynamicRules.join(', ') || 'none'})`);
  check(e.scripts.length === 0, `no registered content scripts (${e.scripts.join(', ') || 'none'})`);
  check(e.webrtc !== 'controlled_by_this_extension', `WebRTC pref left to Chrome (${e.webrtc})`);
  check(e.heartbeatDay === null, 'no usage ping attempted');
  check(e.adRequested && e.adShown, 'ads load and show (no blocking)');
  check(e.pickButton === 0 && e.adFooter === 0, 'popup has no picker button or ad-blocker footer');
  check(!e.headings.some(h => /ad blocking|privacy|cookie guard|usage stats/.test(h)), `settings show only: ${e.headings.join(', ')}`);
  check(e.headings.includes('fine print'), 'fine print settings still shown');

  console.log('\n— normal build (no embed block)');
  const normal = await launch(DIST);
  const n = await inspect(normal);
  await normal.context.close();
  rmSync(normal.profile, { recursive: true, force: true });
  check(n.rulesets.includes('easylist'), 'rulesets enabled');
  check(n.heartbeatDay !== null, 'usage ping attempted (default on)');
  check(!n.adRequested && !n.adShown, 'ads blocked');
  check(n.headings.includes('ad blocking') && n.headings.includes('usage stats'), 'all settings sections shown');

  console.log('\n— blocker on, host hides GPC and cookie guard');
  const hidden = await launch(hideDir);
  const h = await inspect(hidden);
  await hidden.context.close();
  rmSync(hidden.profile, { recursive: true, force: true });
  check(h.rulesets.includes('easylist') && !h.adRequested && !h.adShown, 'ads blocked');
  check(!h.dynamicRules.includes(1001), `no GPC header rule (${h.dynamicRules.join(', ')})`);
  check(h.headings.includes('ad blocking') && !h.headings.includes('cookie guard'), `cookie guard hidden (${h.headings.join(', ')})`);
  check(h.labels.some(l => /Block ads/.test(l)) && !h.labels.some(l => /Global Privacy Control/.test(l)), 'GPC toggle hidden, other toggles shown');
  check(h.heartbeatDay === null, 'no usage ping attempted');
} finally {
  server.close();
  rmSync(embedDir, { recursive: true, force: true });
  rmSync(hideDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall embed checks passed');
process.exit(failures ? 1 : 0);
