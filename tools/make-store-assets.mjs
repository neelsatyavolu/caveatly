// Renders Chrome Web Store assets from the real built popup (dist/) with a
// stubbed chrome API and a fictional site, then composes them into listing art.
// Usage: npm run build && node tools/make-store-assets.mjs → writes store/*.png
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildReport } from '../src/lib/report.js';

const OUT = 'store';
const PORT = 4831;
const MAX_H = 780; // popup content height cap for listing shots
const SITE_URL = 'https://acme-cloud.app/signup';

const report = buildReport({
  site: 'acme-cloud.app',
  title: 'Acme Cloud',
  docLabels: ['Terms of Service', 'Privacy Policy'],
  flags: [
    { tier: 'concern', title: 'Shares your data with ad partners', explanation: 'Your usage data and contact details can be passed to advertising and analytics companies.', clauseRef: 'Privacy Policy · §4', topic: 'Sharing', quote: 'We may share personal information with our advertising and analytics partners.' },
    { tier: 'concern', title: 'Broad license to what you upload', explanation: 'You give Acme a worldwide, royalty-free license to use and modify your files.', clauseRef: 'Terms of Service · §7', topic: 'Licensing', quote: 'you grant us a worldwide, royalty-free license to use, copy, modify and distribute your content' },
    { tier: 'caution', title: 'Auto-renews unless you cancel', explanation: 'Paid plans renew each year at the then-current price.', clauseRef: 'Terms of Service · §11', topic: 'Billing', quote: 'Subscriptions renew automatically at the end of each term.' },
    { tier: 'caution', title: 'Terms can change without notice', explanation: 'Continued use counts as accepting future changes.', clauseRef: 'Terms of Service · §15', topic: 'Changes' },
    { tier: 'caution', title: 'Disputes go to private arbitration', explanation: 'You give up the right to sue in court or join a class action.', clauseRef: 'Terms of Service · §18', topic: 'Legal' },
    { tier: 'safe', title: 'Delete your account anytime', explanation: 'Your data is removed within 30 days of closing your account.', clauseRef: 'Privacy Policy · §9', topic: 'Account' },
    { tier: 'safe', title: 'Export your data whenever you want', explanation: 'You can download everything you have stored.', clauseRef: 'Terms of Service · §6', topic: 'Data' },
    { tier: 'safe', title: 'Encrypted in transit and at rest', explanation: 'Your files are protected with industry-standard encryption.', clauseRef: 'Privacy Policy · §6', topic: 'Security' },
  ],
});

// Stand-in favicon for the fictional site.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#4f46e5"/><path d="M10 23 16 8l6 15M12.4 18h7.2" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CHROME_STUB = `
  window.chrome = {
    storage: {
      session: { get: async () => ({}), remove: async () => {}, set: async () => {} },
      sync: { get: async d => (d && typeof d === 'object' && !Array.isArray(d) ? d : {}), set: async () => {} },
      local: { get: async () => ({ apiKeys: { gemini: 'AIza-demo-key' } }), set: async () => {} },
    },
    tabs: {
      query: async () => [{ id: 1, url: '${SITE_URL}', active: true }],
      get: async () => ({ id: 1, url: '${SITE_URL}' }),
    },
    runtime: {
      id: 'caveatly',
      getURL: p => p,
      sendMessage: async m => m.type === 'getCached' ? { report: window.__REPORT }
        : m.type === 'getConsent' ? { action: 'rejected' } : {},
    },
  };`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
const pages = {};
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/_favicon/')) { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(FAVICON); }
  if (pages[url]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(pages[url]); }
  try {
    const body = readFileSync(join('dist', url === '/' ? 'popup.html' : url));
    res.writeHead(200, { 'content-type': TYPES[extname(url)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT);

const browser = await chromium.launch();

async function popupShot(width, prepare) {
  const page = await browser.newPage({ viewport: { width, height: MAX_H }, deviceScaleFactor: 2 });
  await page.addInitScript(`window.__REPORT = ${JSON.stringify(report)};${CHROME_STUB}`);
  await page.goto(`http://localhost:${PORT}/popup.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  const height = Math.min(MAX_H, Math.ceil(await page.evaluate(() => document.getElementById('root').getBoundingClientRect().height)));
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  await page.close();
  return { src: `data:image/png;base64,${buf.toString('base64')}`, width, height };
}

const home = await popupShot(380);
const full = await popupShot(440, async p => {
  await p.getByText('See full report').click();
  await p.waitForTimeout(300);
  await p.getByText('Shares your data with ad partners').first().click();
});
const settings = await popupShot(380, async p => { await p.getByLabel('Settings').click(); });

const BASE_CSS = `
  @font-face { font-family: 'Newsreader'; src: url(/styles/fonts/newsreader-latin-opsz-normal.woff2); font-weight: 200 800; }
  @font-face { font-family: 'Newsreader'; font-style: italic; src: url(/styles/fonts/newsreader-latin-opsz-italic.woff2); font-weight: 200 800; }
  @font-face { font-family: 'Hanken Grotesk'; src: url(/styles/fonts/hanken-grotesk-latin-wght-normal.woff2); font-weight: 100 900; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #f7f4ee; color: #17161a; font-family: 'Hanken Grotesk', sans-serif; -webkit-font-smoothing: antialiased; }
  .mark { display: inline-block; background: #ffe487; padding: 0 .12em; border-radius: 3px; font-style: italic; }
  .logo { display: flex; align-items: center; gap: 12px; font: 500 30px 'Newsreader', serif; }
  .logo img { border-radius: 9px; }
`;

function screenshotHtml(shot, eyebrow, headline, body) {
  const maxH = 680;
  const scale = Math.min(1, maxH / shot.height);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .frame { width: 1280px; height: 800px; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 64px; padding: 0 96px; overflow: hidden;
      background: radial-gradient(circle at 80% 40%, #e7f2ef 0, transparent 55%), #f7f4ee; }
    .eyebrow { font: 700 15px 'Hanken Grotesk'; letter-spacing: .08em; text-transform: uppercase; color: #0e5c4c; margin: 28px 0 16px; }
    h1 { font: 500 54px/1.06 'Newsreader', serif; letter-spacing: -.02em; margin: 0; }
    p { font-size: 21px; line-height: 1.5; color: #5c5852; margin: 22px 0 0; max-width: 470px; }
    .shot { width: ${shot.width * scale}px; height: ${shot.height * scale}px; border-radius: 16px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(23,22,26,.18), 0 2px 8px rgba(23,22,26,.08); border: 1px solid #e8e2d7; }
    .shot img { width: 100%; height: 100%; display: block; }
  </style></head><body><div class="frame">
    <div><div class="logo"><img src="/icons/icon128.png" width="40" height="40">Caveatly</div>
      <div class="eyebrow">${eyebrow}</div><h1>${headline}</h1><p>${body}</p></div>
    <div class="shot"><img src="${shot.src}"></div>
  </div></body></html>`;
}

function tileHtml(w, h, big) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .tile { width: ${w}px; height: ${h}px; display: flex; flex-direction: column; justify-content: center; padding: 0 ${big ? 120 : 36}px;
      background: radial-gradient(circle at 85% 30%, #e7f2ef 0, transparent 60%), #f7f4ee; overflow: hidden; }
    .logo { font-size: ${big ? 44 : 30}px; gap: ${big ? 16 : 12}px; }
    h1 { font: 500 ${big ? 64 : 30}px/1.08 'Newsreader', serif; letter-spacing: -.02em; margin: ${big ? 30 : 18}px 0 0; max-width: ${big ? 900 : 380}px; }
  </style></head><body><div class="tile">
    <div class="logo"><img src="/icons/icon128.png" width="${big ? 60 : 42}" height="${big ? 60 : 42}">Caveatly</div>
    <h1>Read the fine print <span class="mark">before</span> you click “I agree.”</h1>
  </div></body></html>`;
}

async function render(name, html, width, height) {
  pages[`/__${name}`] = html;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/__${name}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await page.close();
  console.log(`${OUT}/${name}.png`);
}

mkdirSync(OUT, { recursive: true });
await render('screenshot-1-report', screenshotHtml(home, 'Graded A–F', 'Know what you’re agreeing to <span class="mark">before</span> you sign up.', 'Caveatly reads the Terms of Service and Privacy Policy, flags what matters, and grades the whole thing.'), 1280, 800);
await render('screenshot-2-details', screenshotHtml(full, 'Plain English', 'Every flag comes with the exact clause.', 'Tap a flag to see why it matters and the verbatim quote from the policy, so you can check it yourself.'), 1280, 800);
await render('screenshot-3-privacy', screenshotHtml(settings, 'Private by design', 'Your key. Your browser. No Caveatly server.', 'Bring your own free Gemini key. Plus a cookie guard, Global Privacy Control, and tracking-parameter stripping.'), 1280, 800);
await render('promo-small-440x280', tileHtml(440, 280, false), 440, 280);
await render('promo-marquee-1400x560', tileHtml(1400, 560, true), 1400, 560);

await browser.close();
server.close();
