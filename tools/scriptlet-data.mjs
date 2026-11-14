// Turns `##+js(...)` / `#@#+js(...)` lines into the lookup tables that
// src/lib/scriptlet-match.js reads at runtime (format documented there).
import { CosmeticFilter } from '@ghostery/adblocker';

// A plain hostname or an entity (`google.*`). Regex and other wildcard
// domains are rare in scriptlet filters and dropped.
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const MATCHABLE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*$/;

function parseDomains(spec) {
  const include = [];
  const exclude = [];
  for (const raw of spec.split(',')) {
    const negated = raw.startsWith('~');
    const domain = (negated ? raw.slice(1) : raw).trim().toLowerCase();
    const bare = domain.endsWith('.*') ? domain.slice(0, -2) : domain;
    if (!HOST.test(bare)) return null;
    (negated ? exclude : include).push(domain);
  }
  return { include, exclude };
}

function resolveScriptlet(scriptlets, name) {
  const file = name.endsWith('.js') ? name : `${name}.js`;
  if (scriptlets[file]) return scriptlets[file];
  return Object.values(scriptlets).find(s => s.aliases.includes(file)) || null;
}

/**
 * @param sources    [{ lines, trusted }]: scriptlet filter lines per list; `trusted`
 *                   lists may use trusted-* scriptlets (uBO only accepts those from
 *                   its own lists, and so do we)
 * @param scriptlets the vendored uBO scriptlet table (name -> { fn, aliases, requiresTrust })
 */
export function buildScriptletData(sources, scriptlets) {
  const calls = [];
  const callIndex = new Map();
  const filters = [];
  const domains = {};
  const exceptions = {};
  const skipped = { generic: 0, domain: 0, unknown: 0, untrusted: 0 };

  const add = (map, key, value) => { (map[key] ||= []).push(value); };

  const entries = sources.flatMap(({ lines, trusted }) => lines.map(line => ({ line, trusted })));
  for (const { line, trusted } of entries) {
    const sep = line.indexOf('#');
    const unhide = line[sep + 1] === '@';
    const spec = line.slice(0, sep);
    if (!spec) { skipped.generic += 1; continue; } // generic scriptlets: never on every site
    const parsedDomains = parseDomains(spec);
    if (!parsedDomains) { skipped.domain += 1; continue; }

    const filter = CosmeticFilter.parse(line);
    const script = filter?.parseScript();
    if (unhide && !script) { // `#@#+js()` turns off every scriptlet on these domains
      parsedDomains.include.forEach(d => add(exceptions, d, '*'));
      continue;
    }
    if (!script) { skipped.domain += 1; continue; }
    const scriptlet = resolveScriptlet(scriptlets, script.name);
    if (!scriptlet) { skipped.unknown += 1; continue; }
    if (scriptlet.requiresTrust && !trusted) { skipped.untrusted += 1; continue; }

    const call = [scriptlet.fn, ...script.args];
    const key = JSON.stringify(call);
    if (unhide) {
      parsedDomains.include.forEach(d => add(exceptions, d, key));
      continue;
    }
    if (!parsedDomains.include.length) { skipped.generic += 1; continue; }
    if (!callIndex.has(key)) { callIndex.set(key, calls.length); calls.push(call); }
    const id = filters.length;
    filters.push([callIndex.get(key), parsedDomains.exclude]);
    parsedDomains.include.forEach(d => add(domains, d, id));
  }

  // Exact hosts get a document_start MAIN-world content script; Chrome match
  // patterns cannot express entities (`google.*`), so those are injected by the
  // service worker instead (see lib/adblock.js).
  const matches = Object.keys(domains)
    .filter(d => MATCHABLE_HOST.test(d))
    .map(d => `*://*.${d}/*`); // `*.` also matches the domain itself
  return { data: { calls, filters, domains, exceptions }, matches, skipped };
}
