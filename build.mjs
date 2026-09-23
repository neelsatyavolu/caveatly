import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/popup.jsx', 'src/background.js', 'src/consent.js', 'src/pagescan.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  jsx: 'automatic',
  target: ['chrome110'],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  logLevel: 'info',
});

cpSync('src/manifest.json', 'dist/manifest.json');
cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/styles', 'dist/styles', { recursive: true });
cpSync('src/icons', 'dist/icons', { recursive: true });

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
