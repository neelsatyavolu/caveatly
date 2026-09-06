// End-to-end test: loads the built extension into Chromium, visits real sites,
// opens the popup, and verifies the full scan pipeline (page extraction →
// policy fetch → LLM call → rendered report). The LLM is a local mock unless
// GEMINI_API_KEY is set, in which case it hits Gemini for real.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startMockGroq } from './mock-groq.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'screenshots');
const MOCK_PORT = 8973;
const SITES = [
  { url: 'https://github.com/', name: 'github.com' },
  { url: 'https://stripe.com/', name: 'stripe.com' },
  { url: 'https://en.wikipedia.org/wiki/Main_Page', name: 'en.wikipedia.org' },
  { url: 'https://artificialanalysis.ai/', name: 'artificialanalysis.ai' }, // policies are PDFs
];

const geminiKey = process.env.GEMINI_API_KEY || '';
const realKey = geminiKey;
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failures += 1;
};

mkdirSync(SHOTS, { recursive: true });
const { server, requests } = await startMockGroq(MOCK_PORT);

const userDataDir = path.join(ROOT, '.pw-profile');
rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  console.log(`extension loaded: ${extensionId}`);

  const seed = geminiKey
    ? { provider: 'gemini', apiKeys: { gemini: geminiKey } }
    : { provider: 'gemini', apiKeys: { gemini: 'test-key' }, apiBase: `http://127.0.0.1:${MOCK_PORT}` };
  await sw.evaluate(cfg => chrome.storage.local.set(cfg), seed);
  console.log(realKey ? 'using REAL Gemini API' : 'using local mock API');

  for (const site of SITES) {
    console.log(`\n— ${site.name}`);
    const before = requests.length;
    const page = await context.newPage();
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1500);
    } catch (e) {
      check(false, `page load: ${e.message.split('\n')[0]}`);
      await page.close();
      continue;
    }

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // Toolbar never auto-scans — click Scan this page.
    const scanBtn = popup.getByRole('button', { name: 'Scan this page' });
    try {
      await scanBtn.waitFor({ timeout: 10000 });
      await scanBtn.click();
    } catch {
      // Already ready (cached) — continue to report check.
    }
    const reportBtn = popup.getByRole('button', { name: 'See full report' });
    try {
      await reportBtn.waitFor({ timeout: realKey ? 180000 : 60000 });
      check(true, 'scan completed, report rendered');
    } catch {
      const bodyText = (await popup.locator('#root').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 200);
      check(false, `report did not render — popup shows: ${bodyText}`);
      await popup.screenshot({ path: path.join(SHOTS, `${site.name}-failed.png`) });
      await popup.close();
      await page.close();
      continue;
    }

    check((await popup.innerText('#root')).includes(site.name), `site name "${site.name}" shown`);
    const root = popup.locator('#root > div');
    await root.screenshot({ path: path.join(SHOTS, `${site.name}-popup.png`) });

    if (!realKey) {
      const req = requests[requests.length - 1];
      check(requests.length > before, 'LLM request made');
      if (req) {
        check(req.userChars > 2000, `extracted legal text sent (${req.userChars} chars)`);
        check(req.site === site.name, `site passed to model (${req.site})`);
        console.log(`    docs sent: ${req.docHeaders.join(' · ') || '(page itself)'}`);
      }
    }

    await reportBtn.click();
    await popup.getByRole('button', { name: 'Concern', exact: true }).waitFor({ timeout: 5000 });
    check(true, 'full report view opened');
    await root.screenshot({ path: path.join(SHOTS, `${site.name}-report.png`) });

    // expand the first flag that carries a verbatim quote
    const firstFlag = popup.locator('text=/Sells or shares|change without notice/').first();
    if (await firstFlag.count()) {
      await firstFlag.click();
      await popup.waitForTimeout(300);
      await root.screenshot({ path: path.join(SHOTS, `${site.name}-report-expanded.png`) });
    }

    await popup.close();
    await page.close();
  }

  // on-page prompt: a policy page shows the toast → Scan now → grade toast
  console.log('\n— on-page prompt (stripe.com/privacy)');
  // Clear session + durable origin cache/dismiss so the prompt can fire again.
  await sw.evaluate(async () => {
    await chrome.storage.session.clear();
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('report:') || k.startsWith('prompt:'));
    if (keys.length) await chrome.storage.local.remove(keys);
  });
  const signupPage = await context.newPage();
  try {
    await signupPage.goto('https://stripe.com/privacy', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const scanNow = signupPage.locator('#fineprint-prompt button.scan');
    await scanNow.waitFor({ timeout: 15000 });
    check(true, 'scan prompt appeared on signup page');
    await scanNow.click();
    // Scan success opens the report UI and removes the toast; wait for a cached report.
    const deadline = Date.now() + (realKey ? 180000 : 60000);
    let cached = false;
    while (Date.now() < deadline) {
      cached = await sw.evaluate(async () => {
        const k = 'report:https://stripe.com';
        const s = await chrome.storage.session.get(k);
        if (s[k]) return true;
        const l = await chrome.storage.local.get(k);
        return Boolean(l[k]);
      });
      if (cached) break;
      await signupPage.waitForTimeout(500);
    }
    check(cached, 'on-page scan completed, report cached');
    // Extension should open automatically (toolbar popup or detached window).
    const reportUi = context.pages().find(p => /popup\.html/.test(p.url()));
    check(Boolean(reportUi), 'report UI opened automatically');
    if (reportUi) {
      await reportUi.waitForSelector('#root', { timeout: 10000 }).catch(() => {});
      await reportUi.locator('#root > div').screenshot({ path: path.join(SHOTS, 'onpage-prompt-result.png') }).catch(() => {});
    } else {
      await signupPage.screenshot({ path: path.join(SHOTS, 'onpage-prompt-result.png') });
    }
  } catch (e) {
    check(false, `on-page prompt flow: ${e.message.split('\n')[0]}`);
    await signupPage.screenshot({ path: path.join(SHOTS, 'onpage-prompt-failed.png') });
  }
  await signupPage.close();

  // settings screen (once, not per-site)
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${(new URL((context.serviceWorkers()[0]).url())).host}/popup.html`);
  await popup.getByRole('button', { name: 'Settings' }).first().click();
  await popup.getByText(/API key/).first().waitFor({ timeout: 5000 });
  check(true, 'settings screen renders (API key + toggles)');
  await popup.locator('#root > div').screenshot({ path: path.join(SHOTS, 'settings.png') });
  await popup.close();
} finally {
  await context.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
