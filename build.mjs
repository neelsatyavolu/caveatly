import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/popup.jsx', 'src/background.js', 'src/consent.js', 'src/pagescan.js', 'src/adblock.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  jsx: 'automatic',
  target: ['chrome110'],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  logLevel: 'info',
});

// Scriptlets run in the page's MAIN world, one bundle per filter list (see
// src/scriptlets/main.js). Identifiers stay unminified: uBO's scriptlets are
// looked up by function name.
await build({
  entryPoints: ['src/scriptlets/ads.js', 'src/scriptlets/cookies.js', 'src/scriptlets/annoyances.js'],
  bundle: true,
  outdir: 'dist/scriptlets',
  format: 'iife',
  target: ['chrome110'],
  minifyWhitespace: true,
  minifySyntax: true,
  logLevel: 'info',
});

cpSync('src/manifest.json', 'dist/manifest.json');
cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/styles', 'dist/styles', { recursive: true });
cpSync('src/icons', 'dist/icons', { recursive: true });
// Ad blocking: DNR rulesets + cosmetic engine (npm run filters) and the
// site-specific content scripts (sponsored results, Reuters).
// (ubo-scriptlets.js is bundled into the scripts above, not shipped on its own.)
cpSync('src/filters', 'dist/filters', { recursive: true, filter: src => !src.endsWith('.js') });
cpSync('src/content', 'dist/content', { recursive: true });

// Bundle webfonts so the popup makes no requests to Google Fonts.
const FONTS = [
  ['hanken-grotesk', 'hanken-grotesk-latin-wght-normal.woff2'],
  ['newsreader', 'newsreader-latin-opsz-normal.woff2'],
  ['newsreader', 'newsreader-latin-opsz-italic.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
];
mkdirSync('dist/styles/fonts', { recursive: true });
for (const [pkg, file] of FONTS) {
  cpSync(`node_modules/@fontsource-variable/${pkg}/files/${file}`, `dist/styles/fonts/${file}`);
}

console.log('Built extension into dist/');
