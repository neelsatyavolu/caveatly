// Text-level helpers for tools/build-filters.mjs: downloading lists, resolving
// uBO's `!#include` lines and `!#if` preprocessor blocks, and sorting lines into
// network, cosmetic and scriptlet filters.
import { evaluatePreprocessor } from '@ghostery/adblocker';

// The environment the lists are evaluated for. Caveatly is an MV3 Chromium
// extension that runs uBO scriptlets, so uBO-only blocks apply; mobile-, Firefox-
// and Safari-only blocks do not.
const ENV = new Map([
  ['env_chromium', true],
  ['env_mv3', true],
  ['ext_ublock', true],
  ['cap_user_stylesheet', true],
]);

export async function download(url, { included = false } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  const text = await res.text();
  // ABP lists start with "[Adblock Plus"; uBO's with "! Title:". Included
  // sub-lists have no header, so only check that they are not an HTML page.
  const ok = included ? !/^\s*</.test(text) : /^(\[Adblock|! Title:)/.test(text);
  if (!ok) throw new Error(`${url} does not look like a filter list`);
  return text;
}

/** Inlines `!#include file.txt` lines (uBO lists), resolved next to the list's URL. */
export async function withIncludes(text, url, depth = 0) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^!#include\s+(\S+)/);
    if (!match) { out.push(line); continue; }
    if (depth > 2) throw new Error(`${url}: !#include nested too deep`);
    const child = new URL(match[1], url).href;
    out.push(await withIncludes(await download(child, { included: true }), child, depth + 1));
  }
  return out.join('\n');
}

/** Lines of `text` whose `!#if` conditions hold in ENV (handles nesting and !#else). */
export function activeLines(text) {
  const stack = []; // one boolean per open !#if: is this branch active?
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('!#if ')) {
      stack.push(evaluatePreprocessor(line.slice(5).replace(/\s+/g, ''), ENV));
    } else if (line === '!#else') {
      if (stack.length) stack.push(!stack.pop());
    } else if (line === '!#endif') {
      stack.pop();
    } else if (line && !line.startsWith('!') && !line.startsWith('[') && stack.every(Boolean)) {
      out.push(line);
    }
  }
  return out;
}

const COSMETIC = /#[@?$%]?#/;
const SCRIPTLET = /#@?#\+js\(/;

export const isNetworkLine = line => !COSMETIC.test(line);
export const isScriptletLine = line => SCRIPTLET.test(line);
export const isCosmeticLine = line => COSMETIC.test(line) && !SCRIPTLET.test(line);
