// Unit checks for bugfixes that don't need the packed extension: HTML cleanup,
// same-site cookie decision, consent labels, AI retry budgeting, and a few
// browser checks (fixed banners, link extraction, phone nav, popup loading).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { htmlToText } from '../src/lib/html-to-text.js';
import { apexHost, fetchCredentials, relatedOrigins, sharesSite } from '../src/lib/hosts.js';
import { consentChoice } from '../src/lib/consent-labels.js';
import { countPhrase, pageDocLabel } from '../src/lib/report.js';
import { nextCharBudget } from '../src/lib/groq.js';
import { buttonsIn, isBannerVisible } from '../src/consent.js';
import { extractLegalSources } from '../src/lib/extract-page.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failed += 1;
};

console.log('— html to text');
{
  const bad = htmlToText('<p>Keep this &#9999999; clause and &#x110000; the rest.</p>');
  check(bad.includes('Keep this') && bad.includes('clause') && bad.includes('the rest'), 'invalid numeric entities do not drop the document');
  check(htmlToText('<p>It&#39;s fine</p>') === "It's fine", 'valid entities still decode');
  check(!htmlToText('<script>secret()</script><p>Policy text</p>').includes('secret'), 'script bodies are removed');
}

console.log('\n— same-site fetches');
{
  check(sharesSite('https://www.github.com', 'https://docs.github.com'), 'docs.github.com is the same site as github.com');
  check(sharesSite('https://www.amazon.co.uk/gp', 'https://amazon.co.uk/terms'), 'www and apex on co.uk match');
  check(!sharesSite('https://attacker.example', 'https://bank.example/account'), 'a legal link on another site is not same-site');
  check(!sharesSite('https://a.github.io/signup', 'https://b.github.io/private'), 'sibling github.io tenants are not the same site');
  check(!sharesSite('https://evil.co.uk', 'https://amazon.co.uk'), 'different co.uk sites are not the same site');
  check(!sharesSite('https://1.2.3.4', 'https://9.9.3.4'), 'different IP addresses are not the same site');
  check(fetchCredentials('https://shop.example.com', 'https://example.com/privacy') === 'include', 'same-site policy fetch keeps cookies');
  check(fetchCredentials('https://attacker.example', 'https://bank.example/inbox') === 'omit', 'cross-site policy fetch omits cookies');
  check(apexHost('foo.github.io') === 'foo.github.io', 'github.io tenant is its own apex');

  const ip = relatedOrigins('http://127.0.0.1:8080');
  check(ip.length === 1 && ip[0] === 'http://127.0.0.1:8080', `IP origin is not rewritten (${ip.join(', ')})`);
  const usps = relatedOrigins('https://tools.usps.com');
  check(usps.includes('https://tools.usps.com') && usps.includes('https://usps.com') && usps.includes('https://www.usps.com'), `usps parents kept (${usps.join(', ')})`);
  const pages = relatedOrigins('https://foo.github.io');
  check(!pages.some(o => o === 'https://github.io' || o === 'https://www.github.io'), `github.io is not walked up to the suffix (${pages.join(', ')})`);
  const www = relatedOrigins('https://www.github.com');
  check(www.includes('https://www.github.com') && www.includes('https://github.com'), `www and apex both tried (${www.join(', ')})`);
}

console.log('\n— consent button labels');
{
  const expectChoice = {
    Reject: 'rejected',
    'Reject all': 'rejected',
    'Reject all cookies': 'rejected',
    'Decline cookies': 'rejected',
    Deny: 'rejected',
    'Refuse all': 'rejected',
    'Reject non-essential cookies': 'rejected',
    'Continue without accepting': 'rejected',
    'Continue without accepting cookies': 'rejected',
    'Only necessary': 'necessary-only',
    'Necessary only': 'necessary-only',
    'Essential cookies only': 'necessary-only',
    'Use necessary cookies only': 'necessary-only',
    'Strictly necessary': 'necessary-only',
    'Accept only necessary': 'necessary-only',
    'Accept all': null,
    'Accept all cookies': null,
    'Allow all': null,
    'Cookie settings': null,
    'Reject and subscribe': null,
    'non-essential only': null,
  };
  for (const [label, expected] of Object.entries(expectChoice)) {
    check(consentChoice(label) === expected, `"${label}" → ${expected} (got ${consentChoice(label)})`);
  }
}

console.log('\n— report copy');
{
  check(countPhrase(1, 'concern') === '1 concern', 'one concern');
  check(countPhrase(2, 'clause', 'clauses') === '2 clauses', 'two clauses');
  check(pageDocLabel('Cookie Policy', 'https://ex.com/cookies') === 'Cookie Policy', 'cookie page is not labeled as terms');
  check(pageDocLabel('Privacy', 'https://ex.com/privacy') === 'Privacy Policy', 'privacy page label');
  check(nextCharBudget(40000, 'Limit 999999999', 1024) === 20000, 'a 413 limit larger than the request halves instead of growing');
  check(nextCharBudget(40000, 'Limit 6000', 1024) < 20000, 'a 413 limit smaller than half is respected');
}

console.log('\n— AI client');
{
  let n = 0;
  const load = () => import(`../src/lib/groq.js?case=${n++}`);
  const flags = { flags: [{ tier: 'safe', title: 'You can delete your data' }] };
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(flags) } }] }), { status: 200 });
  const doc = 'clause '.repeat(8000);

  {
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      check(init.signal instanceof AbortSignal, 'AI request has a timeout signal');
      return bodies.length === 1 ? new Response('Request too large. Limit 999999999', { status: 413 }) : ok();
    };
    const groq = await load();
    const result = await groq.analyzeLegalDocs({ apiKey: 'k', maxInputChars: 40000, site: 'example.com', docs: [{ label: 'Terms', url: 'https://example.com/t', text: doc }] });
    check(result.length === 1, 'scan succeeds after shrinking a 413');
    const first = bodies[0].messages.find(m => m.role === 'user').content.length;
    const second = bodies[1].messages.find(m => m.role === 'user').content.length;
    check(second < first, `retry sends less text (${first} → ${second})`);
  }

  {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const groq = await load();
    let err = null;
    try {
      await groq.analyzeLegalDocs({ apiKey: 'k', site: 'example.com', docs: [{ label: 'Terms', text: 'short' }] });
    } catch (e) { err = e; }
    check(err instanceof groq.GroqError && err.code === 'network', `network failure is a GroqError (${err?.code})`);
  }
}

console.log('\n— browser');
{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html>
    <div id="fixed" style="position:fixed;left:12px;bottom:12px;background:#fff;padding:16px">Reject</div>
    <div id="hidden" style="display:none">Hidden banner</div>
    <div id="host"></div>`);
  await page.evaluate(() => {
    const host = document.getElementById('host');
    host.attachShadow({ mode: 'open' }).innerHTML = '<button>Reject all</button>';
  });
  const dom = await page.evaluate(({ visibleSrc, buttonsSrc }) => {
    const isBannerVisible = (0, eval)(`(${visibleSrc})`);
    const buttonsIn = (0, eval)(`(${buttonsSrc})`);
    const fixed = document.getElementById('fixed');
    const hidden = document.getElementById('hidden');
    const host = document.getElementById('host');
    return {
      fixedOffsetNull: fixed.offsetParent === null,
      fixedVisible: isBannerVisible(fixed),
      hiddenVisible: isBannerVisible(hidden),
      lightButtons: host.querySelectorAll('button').length,
      shadowButtons: buttonsIn(host).length,
    };
  }, { visibleSrc: isBannerVisible.toString(), buttonsSrc: buttonsIn.toString() });
  check(dom.fixedOffsetNull && dom.fixedVisible, 'fixed banner is visible even though offsetParent is null');
  check(dom.hiddenVisible === false, 'display:none banner is not visible');
  check(dom.lightButtons === 0 && dom.shadowButtons === 1, 'buttons inside an open shadow root are found');

  await page.route('https://example.com/**', route => {
    const url = route.request().url();
    const body = url.endsWith('/privacy')
      ? `<title>Home</title>
         <a href="https://example.com/terms">Terms of Service</a>
         <a href="https://example.com/privacy-policy">Privacy Policy</a>
         <a href="https://example.com/terms-extra">User agreement</a>`
      : url.endsWith('/disagreement')
        ? '<title>Our disagreement with the ruling</title><p>Opinion.</p>'
        : '<title>Illegal substances</title><p>Not a contract.</p>';
    return route.fulfill({ contentType: 'text/html', body });
  });
  await page.goto('https://example.com/privacy');
  const legal = await page.evaluate(extractLegalSources);
  check(legal.looksLegal === true, 'a /privacy URL counts as a legal page');
  check(legal.candidates[0]?.kind === 'terms' && legal.candidates[1]?.kind === 'privacy', `first candidates are terms then privacy (${legal.candidates.map(c => c.kind).join(', ')})`);
  check(legal.candidates.length >= 3, `backup legal links are kept (${legal.candidates.length})`);
  await page.goto('https://example.com/disagreement');
  const opinion = await page.evaluate(extractLegalSources);
  check(opinion.looksLegal === false, 'a "disagreement" title is not treated as the terms');
  await page.goto('https://example.com/article');
  const article = await page.evaluate(extractLegalSources);
  check(article.looksLegal === false, 'an "illegal" title is not treated as a legal page');

  const site = await new Promise(resolve => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const type = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      try {
        res.writeHead(200, { 'content-type': type }).end(await readFile(path.join(ROOT, 'site', rel)));
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`http://127.0.0.1:${site.address().port}/`, { waitUntil: 'domcontentloaded' });
  const privacyLink = page.locator('.nav-links a', { hasText: 'Privacy' });
  check(await privacyLink.isVisible(), 'phone nav still shows Privacy');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!overflow, 'phone layout does not scroll sideways');

  const popupUrl = pathToFileURL(path.join(ROOT, 'dist/popup.html')).href;
  await page.addInitScript(() => {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    globalThis.chrome = {
      storage: {
        session: { get: async () => ({}), remove: async () => {} },
        sync: { get: async (defaults) => { await delay(500); return { ...defaults }; } },
        local: { get: async () => ({}) },
      },
      tabs: { query: async () => [], get: async () => null },
      runtime: { sendMessage: async () => ({ report: null }), getURL: (p) => p },
      windows: { getCurrent: async () => ({ type: 'normal', id: 1, width: 380, height: 600 }) },
    };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(popupUrl);
  const loadingText = await page.locator('#root').innerText();
  check(loadingText.includes('Loading') && !/Reading the fine print/.test(loadingText), `opening the popup does not pretend to scan (${loadingText.replace(/\s+/g, ' ').slice(0, 80)})`);
  await page.getByText('Open a website first').waitFor({ timeout: 4000 });
  check(true, 'popup settles on the empty state');
  const motion = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'fp-progress';
    document.body.appendChild(el);
    return getComputedStyle(el).animationName;
  });
  check(motion === 'none', `reduced motion stops the scan bar (${motion})`);

  site.close();
  await browser.close();
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
