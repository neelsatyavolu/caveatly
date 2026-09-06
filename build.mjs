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

console.log('Built extension into dist/');
