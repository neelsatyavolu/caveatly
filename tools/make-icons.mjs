// Renders the Caveatly extension icon (paper tile · teal asterisk — the
// fine-print footnote mark · highlighter swipe) to PNGs at all manifest sizes.
// Usage: node tools/make-icons.mjs  → writes src/icons/icon{16,32,48,128}.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'src', 'icons');
mkdirSync(OUT, { recursive: true });

// Six-spoke asterisk on a 100-unit grid; spokes are round-capped strokes.
const ASTERISK = `<svg class="mark" viewBox="0 0 100 100" fill="none" stroke="#0e5c4c" stroke-width="15" stroke-linecap="round">
  <path d="M50 18v64"/><path d="M22.3 34 77.7 66"/><path d="M22.3 66 77.7 34"/></svg>`;

const HTML = `<!doctype html><html><head>
<style>
  html, body { margin: 0; background: transparent; }
  .icon { position: relative; width: var(--s); height: var(--s); overflow: hidden;
    border-radius: calc(var(--s) * 0.22);
    background: linear-gradient(180deg, #fbf9f4, #f1ede4);
    box-shadow: inset 0 0 0 calc(max(1px, var(--s) * 0.012)) rgba(23, 22, 26, 0.14); }
  /* highlighter stroke passes behind the mark's lower half — "the caveat, highlighted" */
  .swipe { position: absolute; left: calc(var(--s) * 0.08); top: calc(var(--s) * 0.50);
    width: calc(var(--s) * 0.84); height: calc(var(--s) * 0.28);
    background: #ffe487; border-radius: calc(var(--s) * 0.08);
    transform: rotate(-4deg); }
  .mark { position: absolute; inset: 0; width: 100%; height: 100%; }
</style></head>
<body><div class="icon" id="icon"><div class="swipe"></div>${ASTERISK}</div></body></html>`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size + 8, height: size + 8 }, deviceScaleFactor: 1 });
  await page.setContent(HTML.replace('<html>', `<html style="--s:${size}px">`), { waitUntil: 'networkidle' });
  await page.locator('#icon').screenshot({ path: path.join(OUT, `icon${size}.png`), omitBackground: true });
  await page.close();
  console.log(`icon${size}.png`);
}
await browser.close();
