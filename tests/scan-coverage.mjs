// Scan coverage. Loads dist/ into headless Chromium, points the AI at the local
// mock (tests/mock-groq.mjs) and runs the real scan pipeline ({ type: 'scan',
// tabId } from an extension page).
//   npm run build && npm run test:scan-coverage
//     Offline: local fixture sites (late footers, shadow DOM, German links,
//     well-known paths, JS-built policy, hub pages, login redirects, huge docs,
//     PDFs) and pages extensions cannot script. No network needed.
//   node tests/scan-coverage.mjs --live [--only=github.com,...]
//     Real sites (needs network); writes screenshots/scan-coverage.{json,md}.
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startMockGroq } from './mock-groq.mjs';
import { startFixtureServer } from './scan-fixtures.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'screenshots');
const MOCK_PORT = 8975;
const CONCURRENCY = 4;
const MIN_SENT_CHARS = 2000;
// Headless Chromium says "HeadlessChrome" in its user agent, which many sites
// bot-block; real users never send it, so measure with a normal Chrome UA.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const LIVE_SITES = [
  ['big tech', 'https://www.google.com/'],
  ['big tech', 'https://www.youtube.com/'],
  ['big tech', 'https://www.facebook.com/'],
  ['big tech', 'https://www.instagram.com/'],
  ['big tech', 'https://x.com/'],
  ['big tech', 'https://www.tiktok.com/'],
  ['big tech', 'https://www.linkedin.com/'],
  ['big tech', 'https://www.reddit.com/'],
  ['big tech', 'https://www.amazon.com/'],
  ['big tech', 'https://www.apple.com/'],
  ['big tech', 'https://www.microsoft.com/'],
  ['big tech', 'https://www.netflix.com/'],
  ['big tech', 'https://www.spotify.com/'],
  ['news', 'https://www.nytimes.com/'],
  ['news', 'https://www.bbc.com/'],
  ['news', 'https://www.cnn.com/'],
  ['news', 'https://www.reuters.com/'],
  ['news', 'https://www.theguardian.com/'],
  ['shops', 'https://www.walmart.com/'],
  ['shops', 'https://www.target.com/'],
  ['shops', 'https://www.ebay.com/'],
  ['shops', 'https://www.etsy.com/'],
  ['shops', 'https://www.bestbuy.com/'],
  ['shops', 'https://www.shopify.com/'],
  ['saas', 'https://github.com/'],
  ['saas', 'https://stripe.com/'],
  ['saas', 'https://www.notion.so/'],
  ['saas', 'https://slack.com/'],
  ['saas', 'https://zoom.us/'],
  ['saas', 'https://www.dropbox.com/'],
  ['saas', 'https://openai.com/'],
  ['saas', 'https://www.figma.com/'],
  ['travel/finance', 'https://www.airbnb.com/'],
  ['travel/finance', 'https://www.booking.com/'],
  ['travel/finance', 'https://www.uber.com/'],
  ['travel/finance', 'https://www.paypal.com/'],
  ['travel/finance', 'https://www.chase.com/'],
  ['spa', 'https://app.netlify.com/'],
  ['spa', 'https://discord.com/'],
  ['spa', 'https://www.canva.com/'],
  ['non-english', 'https://www.spiegel.de/'],
  ['non-english', 'https://www.lemonde.fr/'],
  ['non-english', 'https://elpais.com/'],
  ['pdf policies', 'https://artificialanalysis.ai/'],
  ['subdomain', 'https://support.google.com/accounts/'],
  ['subdomain', 'https://tools.usps.com/go/TrackConfirmAction_input'],
  ['subdomain', 'https://docs.github.com/en'],
  ['other', 'https://en.wikipedia.org/wiki/Main_Page'],
  ['other', 'https://duckduckgo.com/'],
];

function hostOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

async function launch(extraArgs = []) {
  const userDataDir = path.join(ROOT, `.pw-profile-scan-${process.pid}`);
  rmSync(userDataDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--user-agent=${USER_AGENT}`,
      ...extraArgs,
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  await sw.evaluate(cfg => Promise.all([
    chrome.storage.local.set(cfg),
    chrome.storage.sync.set({ pageScan: 'off', usageStats: false }),
  ]), { provider: 'gemini', apiKeys: { gemini: 'test-key' }, apiBase: `http://127.0.0.1:${MOCK_PORT}` });
  // Any extension page can message the worker; the popup is the real caller.
  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${extensionId}/popup.html`);
  const cleanup = async () => {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  };
  return { context, sw, ctl, extensionId, cleanup };
}

async function tabIdFor(ctl, url) {
  return ctl.evaluate(async u => {
    const tabs = await chrome.tabs.query({});
    return (tabs.find(t => t.url === u) || null)?.id ?? null;
  }, url);
}

export async function scanTab(ctl, tabId) {
  return ctl.evaluate(id => chrome.runtime.sendMessage({ type: 'scan', tabId: id }), tabId);
}

async function scanSite(env, requests, [category, url]) {
  const started = Date.now();
  const row = { category, url, site: hostOf(url), ok: false, reason: '', candidates: [], docs: [], sentChars: 0, ms: 0 };
  const page = await env.context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    row.finalUrl = page.url();
    const tabId = await tabIdFor(env.ctl, page.url());
    if (tabId == null) throw new Error('tab not found');
    const resp = await Promise.race([
      scanTab(env.ctl, tabId),
      new Promise(resolve => setTimeout(() => resolve({ ok: false, error: 'harness-timeout', message: 'scan took over 120 s' }), 120000)),
    ]);
    row.candidates = resp?.sources?.candidates || [];
    row.docs = resp?.sources?.docs || [];
    row.failures = resp?.sources?.failures || [];
    const req = [...requests].reverse().find(r => r.site === resp?.report?.site);
    row.sentChars = resp?.ok && req ? req.userChars : 0;
    row.ok = Boolean(resp?.ok) && row.sentChars >= MIN_SENT_CHARS;
    row.reason = resp?.ok ? (row.ok ? '' : `only ${row.sentChars} chars sent`) : `${resp?.error}: ${resp?.message || ''}`;
  } catch (e) {
    row.reason = `harness: ${e.message.split('\n')[0]}`;
  } finally {
    row.ms = Date.now() - started;
    await page.close().catch(() => {});
  }
  const docs = row.docs.map(d => `${d.label} ${Math.round(d.chars / 1000)}k`).join(', ');
  console.log(`${row.ok ? '  ✓' : '  ✗'} ${row.site.padEnd(28)} ${(row.ms / 1000).toFixed(1).padStart(5)}s  ${row.ok ? docs : row.reason}`);
  return row;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

function markdown(rows) {
  const passed = rows.filter(r => r.ok).length;
  const lines = [
    `# Scan coverage`,
    '',
    `${passed}/${rows.length} sites (${Math.round((passed / rows.length) * 100)}%) produced a scan with at least ${MIN_SENT_CHARS} characters of policy text. Generated ${new Date().toISOString()}.`,
    '',
    '| Site | Category | Result | Candidates | Docs fetched | Time |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const docs = r.docs.map(d => `${d.label} (${d.chars.toLocaleString('en-US')} chars)`).join('<br>') || '-';
    const result = r.ok ? 'ok' : r.reason.replace(/\|/g, '/');
    lines.push(`| ${r.site} | ${r.category} | ${result} | ${r.candidates.length} | ${docs} | ${(r.ms / 1000).toFixed(1)}s |`);
  }
  return lines.join('\n') + '\n';
}

async function runLive() {
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const sites = only.length ? LIVE_SITES.filter(([, u]) => only.includes(hostOf(u))) : LIVE_SITES;
  const { server, requests } = await startMockGroq(MOCK_PORT);
  const env = await launch(['--host-resolver-rules=MAP analytics.n3el.dev ~NOTFOUND']);
  try {
    console.log(`scanning ${sites.length} live sites…`);
    const rows = await pool(sites, CONCURRENCY, s => scanSite(env, requests, s));
    mkdirSync(SHOTS, { recursive: true });
    const suffix = process.env.SCAN_COVERAGE_TAG ? `-${process.env.SCAN_COVERAGE_TAG}` : '';
    writeFileSync(path.join(SHOTS, `scan-coverage${suffix}.json`), JSON.stringify(rows, null, 2));
    writeFileSync(path.join(SHOTS, `scan-coverage${suffix}.md`), markdown(rows));
    const passed = rows.filter(r => r.ok).length;
    console.log(`\n${passed}/${rows.length} sites scanned (${Math.round((passed / rows.length) * 100)}%)`);
  } finally {
    await env.cleanup();
    server.close();
  }
}

const FIXTURE_PORT = 8976;

// URL and error-text rules for pages we can't load offline (the real Chrome
// Web Store, a PDF viewer tab). Chrome's wording is copied from its errors.
async function checkScanTargets(check) {
  const { unsupportedTab, injectionFailure } = await import('../src/lib/scan-target.js');
  console.log('— scan-target rules (unit)');
  const store = await unsupportedTab({ url: 'https://chromewebstore.google.com/detail/caveatly/abc' });
  check(store?.error === 'unsupported-page' && /Web Store/.test(store.message), 'Chrome Web Store URL');
  const gallery = injectionFailure(new Error('The extensions gallery cannot be scripted.'), {});
  check(/Web Store/.test(gallery.message), 'extensions-gallery error');
  const pdf = injectionFailure(new Error('Cannot access contents of the page.'), { url: 'https://example.com/terms.pdf' });
  check(pdf.error === 'pdf-viewer', 'PDF viewer tab');
  check((await unsupportedTab({ url: 'file:///Users/me/terms.html' }))?.error === 'unsupported-page', 'file:// URL');
  check((await unsupportedTab({ url: 'https://example.com/' })) === null, 'regular page is scannable');
}

const tabIds = ctl => ctl.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.map(t => t.id)));

async function scanUrl(env, url) {
  const before = await tabIds(env.ctl);
  const page = await env.context.newPage();
  // A failed navigation rejects before Chrome commits its error page.
  await page.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => page.waitForTimeout(1500));
  // tab.url is hidden on chrome:// and file:// pages, so find the new tab by id.
  const tabId = (await tabIds(env.ctl)).find(id => !before.includes(id)) ?? null;
  const resp = tabId == null ? { ok: false, error: 'harness', message: `no tab for ${url}` } : await scanTab(env.ctl, tabId);
  await page.close().catch(() => {});
  return resp;
}

async function runOffline() {
  let failures = 0;
  const check = (ok, label) => {
    console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
    if (!ok) failures += 1;
  };
  const { server: mock, requests } = await startMockGroq(MOCK_PORT);
  const { server, hits } = await startFixtureServer(FIXTURE_PORT);
  const env = await launch([
    '--host-resolver-rules=MAP *.test 127.0.0.1, MAP chromewebstore.google.com ~NOTFOUND, MAP down.invalid ~NOTFOUND, MAP analytics.n3el.dev ~NOTFOUND',
  ]);
  const site = host => `http://${host}:${FIXTURE_PORT}/`;
  const docPaths = resp => (resp.sources?.docs || []).map(d => `${d.kind}:${new URL(d.url).pathname}`).sort();
  const lastRequest = host => [...requests].reverse().find(r => r.site === host);
  try {
    console.log('— late footer in shadow DOM, article links that mention "terms"');
    let r = await scanUrl(env, site('late.test'));
    check(r.ok, `scan succeeded (${r.error || 'ok'})`);
    check(docPaths(r).join() === 'privacy:/legal/privacy,terms:/terms', `read the late footer links (${docPaths(r)})`);
    check(!hits.some(h => /midterms|podcasts/.test(h)), 'never fetched the "midterms" article or the podcast page');

    console.log('— German links, Impressum is not a privacy policy');
    r = await scanUrl(env, site('de.test'));
    check(docPaths(r).join() === 'privacy:/datenschutz,terms:/agb', `Datenschutzerklärung + AGB (${docPaths(r)})`);
    check(!hits.includes('de.test/impressum'), 'Impressum never fetched');

    console.log('— no links: well-known paths, validated by content');
    r = await scanUrl(env, site('bare.test'));
    check(docPaths(r).join() === 'privacy:/privacy,terms:/terms-of-use', `guessed /privacy and /terms-of-use, skipped soft-404 /terms (${docPaths(r)})`);

    console.log('— policy built by JavaScript: rendered in a background tab');
    const tabsBefore = await env.ctl.evaluate(() => chrome.tabs.query({}).then(t => t.length));
    r = await scanUrl(env, site('js.test'));
    const jsPrivacy = (r.sources?.docs || []).find(d => d.kind === 'privacy');
    check(Boolean(jsPrivacy) && jsPrivacy.chars > 3000, `rendered privacy policy read (${jsPrivacy?.chars || 0} chars)`);
    const tabsAfter = await env.ctl.evaluate(() => chrome.tabs.query({}).then(t => t.length));
    check(tabsAfter === tabsBefore, `background render tab closed (${tabsBefore} → ${tabsAfter} tabs)`);

    console.log('— hub page links on to the real policy');
    r = await scanUrl(env, site('hub.test'));
    check(docPaths(r).includes('privacy:/privacy/full-policy'), `followed the hub (${docPaths(r)})`);

    console.log('— terms link redirects to a sign-in page');
    r = await scanUrl(env, site('login.test'));
    check(r.ok && docPaths(r).join() === 'privacy:/privacy', `sign-in page not analyzed (${docPaths(r)})`);

    console.log('— very large documents share the AI budget');
    r = await scanUrl(env, site('big.test'));
    const big = lastRequest('big.test');
    check(r.ok && big?.docHeaders.length === 2, `both documents sent (${big?.docHeaders.join(', ')})`);
    check(big && big.userChars <= 202000, `request stays within the 200k budget (${big?.userChars} chars)`);

    console.log('— PDF policy');
    r = await scanUrl(env, site('pdf.test'));
    const pdf = (r.sources?.docs || []).find(d => d.kind === 'privacy');
    check(Boolean(pdf) && pdf.url.endsWith('.pdf') && pdf.chars > 800, `PDF read (${pdf?.chars || 0} chars)`);

    console.log('— PDF open in a tab is scanned as the document itself');
    r = await scanUrl(env, `${site('pdf.test')}privacy.pdf`);
    check(r.ok && r.sources?.docs.length === 1 && r.sources.docs[0].kind === 'privacy', `PDF tab scanned (${r.error || docPaths(r)})`);

    console.log('— pages extensions cannot script get specific messages');
    r = await scanUrl(env, 'chrome://version/');
    check(r.error === 'unsupported-page' && /browser page/.test(r.message), `chrome:// → ${r.message}`);
    const file = path.join(tmpdir(), `caveatly-scan-${process.pid}.html`);
    writeFileSync(file, '<title>local</title><a href="privacy.html">Privacy</a>');
    r = await scanUrl(env, `file://${file}`);
    rmSync(file, { force: true });
    check(r.error === 'unsupported-page' && /file on your computer/.test(r.message), `file:// → ${r.message}`);
    r = await scanUrl(env, 'http://down.invalid/');
    check(r.error === 'page-error', `browser error page → ${r.message}`);
  } finally {
    await env.cleanup();
    server.close();
    mock.close();
  }
  await checkScanTargets(check);
  console.log(failures ? `\n${failures} check(s) failed` : '\nall scan-coverage checks passed');
  process.exit(failures ? 1 : 0);
}

if (process.argv.includes('--live')) await runLive();
else await runOffline();
