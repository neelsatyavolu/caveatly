// Renders the Fineprint extension icon (teal tile · serif F · highlighter
// swipe, per the design system's brand cards) to PNGs at all manifest sizes.
// Usage: node tools/make-icons.mjs  → writes src/icons/icon{16,32,48,128}.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'src', 'icons');
mkdirSync(OUT, { recursive: true });

const HTML = `<!doctype html><html><head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600&display=swap');
  html, body { margin: 0; background: transparent; }
  .icon { position: relative; width: var(--s); height: var(--s); overflow: hidden;
    border-radius: calc(var(--s) * 0.22);
    background: linear-gradient(180deg, #fbf9f4, #f1ede4);
    box-shadow: inset 0 0 0 calc(max(1px, var(--s) * 0.012)) rgba(23, 22, 26, 0.14); }
  /* highlighter stroke passes behind the glyph's lower half — "fine print, highlighted" */
  .swipe { position: absolute; left: calc(var(--s) * 0.07); top: calc(var(--s) * 0.44);
    width: calc(var(--s) * 0.86); height: calc(var(--s) * 0.30);
    background: #ffe487; border-radius: calc(var(--s) * 0.08);
    transform: rotate(-4deg); }
  .f { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: 'Newsreader', Georgia, serif; font-weight: 600; color: #0e5c4c;
    font-size: calc(var(--s) * 0.78); line-height: 1; padding-bottom: calc(var(--s) * 0.04); }
</style></head>
<body><div class="icon" id="icon"><div class="swipe"></div><div class="f">F</div></div></body></html>`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size + 8, height: size + 8 }, deviceScaleFactor: 1 });
  await page.setContent(HTML.replace('<html>', `<html style="--s:${size}px">`), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#icon').screenshot({ path: path.join(OUT, `icon${size}.png`), omitBackground: true });
  await page.close();
  console.log(`icon${size}.png`);
}
await browser.close();
