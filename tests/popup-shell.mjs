// Chrome action popups size to html/body. If those have no width, the
// popup expands to the browser's default/max and the 380px report sits
// in a huge empty panel (see bloomberg screenshot). This loads the built
// popup shell in a wide viewport and asserts the document stays compact.
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const htmlPath = path.join(ROOT, 'dist', 'popup.html');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(pathToFileURL(htmlPath).href);

const dims = await page.evaluate(() => {
  const html = document.documentElement.getBoundingClientRect();
  const body = document.body.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  return {
    htmlWidth: html.width,
    bodyWidth: body.width,
    declaredWidth: cs.width,
  };
});

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failed += 1;
};

check(dims.htmlWidth === 380, `html width is 380px in a 1200px viewport (got ${dims.htmlWidth})`);
check(dims.bodyWidth === 380, `body width is 380px (got ${dims.bodyWidth})`);
check(
  dims.declaredWidth === '380px',
  `html computed width is 380px (got ${dims.declaredWidth})`,
);

await page.evaluate(() => { document.documentElement.dataset.view = 'report'; });
const reportWidth = await page.evaluate(() => document.documentElement.getBoundingClientRect().width);
check(reportWidth === 440, `report view html width is 440px (got ${reportWidth})`);

await browser.close();
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
