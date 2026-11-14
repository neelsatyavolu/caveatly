import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

// Ghostery's DOM monitor queues every element added since its last pass and
// then reads the ids, classes and links of each one's whole subtree. A page
// that re-renders a list with innerHTML adds the list again on every change,
// so by the time the queue is read most of those elements are already gone,
// and reading them made such pages up to 3x slower (Speedometer's jQuery and
// vanilla TodoMVC). Elements no longer in the document can't be shown, so
// their features don't matter: skip them. The build fails if the line moves.
const skipDetachedNodes = {
  name: 'skip-detached-nodes',
  setup(b) {
    b.onLoad({ filter: /@ghostery[\\/]adblocker-content[\\/]dist[\\/]esm[\\/]index\.js$/ }, args => {
      const before = 'this.handleUpdatedNodes(Array.from(nodes));';
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes(before)) throw new Error('skip-detached-nodes: Ghostery DOMMonitor changed; update build.mjs');
      return { contents: source.replace(before, 'this.handleUpdatedNodes(Array.from(nodes).filter((node) => node.isConnected));'), loader: 'js' };
    });
  },
};

await build({
  entryPoints: ['src/popup.jsx', 'src/background.js', 'src/consent.js', 'src/pagescan.js', 'src/adblock.js', 'src/link-unwrap.js'],
  plugins: [skipDetachedNodes],
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
