// Host-controlled ad blocker: copies dist/ with "caveatly_embed": { controller: <id> }
// and loads a stand-in for the Perch extension under that fixed id (from a
// generated manifest "key"). Checks Caveatly takes its on/off and site list from
// the controller only, answers caveatly.ready at startup, and hides its own switch.
//   npm run build && npm run test:controller
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SITE = 'controller-test.example';
const SUB = `news.${SITE}`;
const AD_HOST = 'securepubads.g.doubleclick.net';
const PAGE = `<!doctype html><title>t</title><div class="ad-unit">AD</div>
<script src="http://${AD_HOST}:PORT/gpt.js"></script>`;
const MANAGED_TEXT = 'Ad blocking is managed by Perch: Settings, Privacy.';

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};

const hits = [];
const server = createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  hits.push(host);
  const isPage = host === SITE || host === SUB;
  res.writeHead(200, { 'content-type': isPage ? 'text/html' : 'text/javascript' });
  res.end(isPage ? PAGE.replace('PORT', String(server.address().port)) : '');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

// An extension's id is the first 32 hex chars of sha256(public key DER), mapped 0-f → a-p.
function fixedIdKey() {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
    .map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  return { key: der.toString('base64'), id };
}

// Stand-in host extension: answers caveatly.ready with its stored state and can push state.
function hostExtension(dir, key) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Host stand-in', version: '1.0', key,
    background: { service_worker: 'sw.js' }, permissions: ['storage'],
  }));
  writeFileSync(path.join(dir, 'sw.js'), `
const INITIAL = { type: 'perch.blocker', on: true, sitesOff: ['other.example'] };
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'caveatly.ready') return false;
  chrome.storage.local.get({ readyCount: 0 }).then(({ readyCount }) => chrome.storage.local.set({ readyCount: readyCount + 1 }));
  sendResponse(INITIAL);
  return false;
});
self.push = (id, msg) => chrome.runtime.sendMessage(id, msg);
`);
  return dir;
}

// A second extension with no say over Caveatly.
function strangerExtension(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Stranger', version: '1.0', background: { service_worker: 'sw.js' },
  }));
  writeFileSync(path.join(dir, 'sw.js'), 'self.push = (id, msg) => chrome.runtime.sendMessage(id, msg);');
  return dir;
}

const work = mkdtempSync(path.join(tmpdir(), 'caveatly-controller-'));
const { key, id: HOST_ID } = fixedIdKey();
const caveatlyDir = path.join(work, 'caveatly');
cpSync(DIST, caveatlyDir, { recursive: true });
const manifestPath = path.join(caveatlyDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
writeFileSync(manifestPath, JSON.stringify({ ...manifest, caveatly_embed: { telemetry: false, hide: ['gpc', 'cookieGuard'], controller: HOST_ID } }));
const hostDir = hostExtension(path.join(work, 'host'), key);
const strangerDir = strangerExtension(path.join(work, 'stranger'));
const exts = [hostDir, strangerDir, caveatlyDir].join(',');

const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${exts}`,
    `--load-extension=${exts}`,
    `--host-resolver-rules=MAP ${SITE} 127.0.0.1, MAP ${SUB} 127.0.0.1, MAP ${AD_HOST} 127.0.0.1, MAP analytics.n3el.dev ~NOTFOUND`,
  ],
});

async function workers() {
  for (let i = 0; i < 50; i++) {
    const sws = context.serviceWorkers();
    const byName = async name => {
      for (const sw of sws) if ((await sw.evaluate(() => chrome.runtime.getManifest().name)) === name) return sw;
      return null;
    };
    const found = { caveatly: await byName('Caveatly'), host: await byName('Host stand-in'), stranger: await byName('Stranger') };
    if (found.caveatly && found.host && found.stranger) return found;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('extension service workers did not start');
}

async function visit(page, host = SITE) {
  hits.length = 0;
  await page.goto(`http://${host}:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  return { ad: hits.includes(AD_HOST), adShown: await page.$eval('.ad-unit', el => getComputedStyle(el).display !== 'none') };
}

const storedState = sw => sw.evaluate(async () => (await chrome.storage.local.get('controllerState')).controllerState || null);

try {
  const { caveatly, host, stranger } = await workers();
  const caveatlyId = await caveatly.evaluate(() => chrome.runtime.id);
  check(await host.evaluate(() => chrome.runtime.id) === HOST_ID, `host stand-in loaded under the fixed id (${HOST_ID})`);
  await new Promise(r => setTimeout(r, 2500)); // onInstalled: rulesets, scripts, caveatly.ready

  console.log('— startup');
  const initial = await storedState(caveatly);
  check(initial?.on === true && initial?.sitesOff?.[0] === 'other.example', `state taken from the caveatly.ready reply (${JSON.stringify(initial)})`);
  const page = await context.newPage();
  let r = await visit(page);
  check(!r.ad && !r.adShown, 'ads blocked');

  console.log('\n— host turns the blocker off on one site');
  const reply = await host.evaluate(([id]) => self.push(id, { type: 'perch.blocker', on: true, sitesOff: [`www.${'controller-test.example'}`] }), [caveatlyId]);
  check(reply?.ok === true, 'host gets { ok: true }');
  await page.waitForTimeout(800);
  r = await visit(page);
  check(r.ad && r.adShown, 'ads allowed on that site');
  r = await visit(page, SUB);
  check(r.ad && r.adShown, 'and on its subdomains');

  console.log('\n— host turns the blocker off everywhere');
  await host.evaluate(([id]) => self.push(id, { type: 'perch.blocker', on: false, sitesOff: [] }), [caveatlyId]);
  await page.waitForTimeout(800);
  const rulesets = await caveatly.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  check(!rulesets.includes('easylist'), `rulesets off (${rulesets.join(', ') || 'none'})`);
  r = await visit(page);
  check(r.ad && r.adShown, 'ads allowed');

  console.log('\n— another extension and bad messages are ignored');
  const strangerReply = await stranger.evaluate(([id]) => self.push(id, { type: 'perch.blocker', on: true, sitesOff: [] }).catch(e => ({ error: e.message })), [caveatlyId]);
  check(!strangerReply?.ok, `stranger gets no { ok: true } (${JSON.stringify(strangerReply)})`);
  await host.evaluate(([id]) => self.push(id, { type: 'perch.blocker', on: 'yes', sitesOff: [] }).catch(() => null), [caveatlyId]);
  check((await storedState(caveatly))?.on === false, 'state unchanged');

  console.log('\n— back on, then the popup');
  await host.evaluate(([id]) => self.push(id, { type: 'perch.blocker', on: true, sitesOff: [] }), [caveatlyId]);
  await page.waitForTimeout(800);
  r = await visit(page);
  check(!r.ad && !r.adShown, 'ads blocked again');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${caveatlyId}/popup.html`);
  await popup.waitForTimeout(1200);
  check(await popup.getByText('Pause on this site').count() === 0, 'no per-site pause in the popup');
  await popup.getByLabel('Settings').click();
  await popup.waitForTimeout(400);
  check(await popup.getByText(MANAGED_TEXT).count() === 1, 'settings say Perch manages ad blocking');
  check(await popup.getByText('Ad blocker', { exact: true }).count() === 0, 'no Ad blocker switch');
  check(await popup.getByText('Block ads', { exact: true }).count() === 1, 'list toggles still shown');
} finally {
  await context.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall controller checks passed');
process.exit(failures ? 1 : 0);
