// Refreshes the ad-blocking data in src/filters/ from the upstream lists:
//   <ruleset>.json             declarativeNetRequest rulesets (network blocking)
//   cosmetic-<group>.bin       serialized Ghostery engines (element hiding)
//   scriptlets-<group>.json    `##+js(...)` scriptlet tables (lib/scriptlet-match.js)
//   scriptlet-matches.json     hostnames each scriptlet table is registered for
//   ubo-scriptlets.js          uBlock Origin's scriptlet code (GPL-3.0)
//   sources.json               where everything came from, when, and its license
// Run with `npm run filters`, review the diff, then `npm run build`.
// Block rules get ids below ALLOW_ID_BASE and allow rules ids from it upward,
// so the popup can count blocked requests without loading the rulesets.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { FiltersEngine } from '@ghostery/adblocker';
import { ALLOW_ID_BASE, MAX_REGEX_RULES, MAX_STATIC_RULES } from '../src/lib/adblock-ids.js';
import { download, withIncludes, activeLines, isNetworkLine, isCosmeticLine, isScriptletLine } from './filter-text.mjs';
import { buildScriptletData } from './scriptlet-data.mjs';

const require = createRequire(import.meta.url);
const { convertFilter } = require('@eyeo/abp2dnr');

const UASSETS = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters';
// Every list here allows redistribution. uBO's lists and scriptlet code are
// GPL-3.0, EasyList/EasyPrivacy GPL-3.0 or CC BY-SA 3.0, Fanboy's lists CC BY 3.0.
const SOURCES = {
  easylist: { url: 'https://easylist.to/easylist/easylist.txt', license: 'GPL-3.0-or-later OR CC-BY-SA-3.0' },
  easyprivacy: { url: 'https://easylist.to/easylist/easyprivacy.txt', license: 'GPL-3.0-or-later OR CC-BY-SA-3.0' },
  // The uBO-syntax builds: same rules as the ABP ones plus `+js` scriptlets
  // that click "reject" or set consent cookies where hiding is not enough.
  cookies: { url: 'https://secure.fanboy.co.nz/easylist-cookie.txt', license: 'CC-BY-3.0' },
  // Includes Fanboy Social, Newsletter and Notifications, and the whole cookie
  // list (subtracted below so the two settings stay independent).
  annoyances: { url: 'https://secure.fanboy.co.nz/fanboy-annoyance.txt', license: 'CC-BY-3.0' },
  // uBlock filters: only their cosmetic and scriptlet lines are used (YouTube,
  // anti-adblock walls); their network rules would not fit the rule budget.
  ubo: { url: `${UASSETS}/filters.txt`, license: 'GPL-3.0', includes: true, trusted: true },
  uboQuickFixes: { url: `${UASSETS}/quick-fixes.txt`, license: 'GPL-3.0', trusted: true },
};
// Ghostery's flattening of uBO's scriptlets into one run(globals, calls) function.
const SCRIPTLETS_REPO = 'ghostery/scriptlets';

// Output → sources. Ruleset ids must match manifest.json and lib/adblock-ids.js.
const RULESETS = { easylist: ['easylist'], easyprivacy: ['easyprivacy'], cookies: ['cookies'], annoyances: ['annoyances'] };
const GROUPS = { ads: ['easylist', 'ubo', 'uboQuickFixes'], cookies: ['cookies'], annoyances: ['annoyances'] };
// Hand-written rulesets that ship next to the generated ones.
const EXTRA_RULESETS = ['reuters'];
const OUT = 'src/filters';

// ————— Network rules —————

async function toRuleset(name, lines) {
  const rules = [];
  let regexCount = 0;
  let failed = 0;
  for (const line of lines) {
    let converted;
    try { converted = await convertFilter(line); } catch { failed += 1; continue; }
    for (const rule of converted) {
      if (rule.condition?.regexFilter && ++regexCount > MAX_REGEX_RULES) continue;
      rules.push(rule);
    }
  }
  if (regexCount > MAX_REGEX_RULES) console.warn(`${name}: dropped ${regexCount - MAX_REGEX_RULES} regex rules over the cap`);
  return { rules: numberRules(mergeDomainRules(rules)), failed };
}

// `||example.com^` with no path is the same match as requestDomains: ["example.com"].
// Folding those into shared rules keeps the rulesets far below Chrome's
// 30,000 guaranteed static rules (EasyList alone has ~45k such filters).
const PLAIN_DOMAIN = /^\|\|([a-z0-9.-]+)\^$/i;
const DOMAINS_PER_RULE = 5000;

function mergeDomainRules(rules) {
  const groups = new Map();
  const rest = [];
  for (const rule of rules) {
    const match = rule.condition?.urlFilter?.match(PLAIN_DOMAIN);
    if (!match || rule.condition.requestDomains) { rest.push(rule); continue; }
    const { urlFilter, ...condition } = rule.condition;
    const key = JSON.stringify([rule.priority, rule.action, condition]);
    if (!groups.has(key)) groups.set(key, { rule: { ...rule, condition }, domains: new Set() });
    groups.get(key).domains.add(match[1].toLowerCase());
  }
  const merged = [];
  for (const { rule, domains } of groups.values()) {
    const list = [...domains];
    for (let i = 0; i < list.length; i += DOMAINS_PER_RULE) {
      merged.push({ ...rule, condition: { ...rule.condition, requestDomains: list.slice(i, i + DOMAINS_PER_RULE) } });
    }
  }
  return [...merged, ...rest];
}

function numberRules(rules) {
  let blockId = 1;
  let allowId = ALLOW_ID_BASE;
  return rules.map(rule => {
    const isAllow = rule.action.type === 'allow' || rule.action.type === 'allowAllRequests';
    return { ...rule, id: isAllow ? allowId++ : blockId++ };
  });
}

// ————— Downloads —————

const sha256 = text => createHash('sha256').update(text).digest('hex');

async function fetchSources() {
  const lines = {};
  const meta = {};
  for (const [name, source] of Object.entries(SOURCES)) {
    const raw = await download(source.url);
    const text = source.includes ? await withIncludes(raw, source.url) : raw;
    lines[name] = activeLines(text);
    meta[name] = { url: source.url, license: source.license, sha256: sha256(text) };
  }
  // The annoyance list embeds the cookie list; keep only what is its own.
  const cookieLines = new Set(lines.cookies);
  lines.annoyances = lines.annoyances.filter(line => !cookieLines.has(line));
  return { lines, meta };
}

async function fetchScriptlets() {
  const res = await fetch(`https://api.github.com/repos/${SCRIPTLETS_REPO}/commits/main`, {
    headers: { accept: 'application/vnd.github.sha' },
  });
  if (!res.ok) throw new Error(`could not resolve ${SCRIPTLETS_REPO}@main: HTTP ${res.status}`);
  const commit = (await res.text()).trim();
  const url = `https://raw.githubusercontent.com/${SCRIPTLETS_REPO}/${commit}/ubo.js`;
  const code = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
    return r.text();
  });
  if (!code.includes('export function run(') || !code.includes('GNU General Public License')) {
    throw new Error(`${url} is not the expected uBO scriptlet bundle`);
  }
  const path = `${OUT}/ubo-scriptlets.js`;
  writeFileSync(path, code);
  const table = (await import(pathToFileURL(path).href)).default;
  return { table, meta: { url, license: 'GPL-3.0', sha256: sha256(code) } };
}

// ————— Build —————

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value));
  return readFileSync(path).length;
}

async function buildRulesets(lines) {
  const counts = {};
  for (const [id, names] of Object.entries(RULESETS)) {
    const { rules, failed } = await toRuleset(id, names.flatMap(n => lines[n]).filter(isNetworkLine));
    const regex = rules.filter(r => r.condition.regexFilter).length;
    writeJson(`${OUT}/${id}.json`, rules);
    counts[id] = rules.length;
    console.log(`${id}.json: ${rules.length} rules (${regex} regex, ${failed} filters not convertible)`);
    if (regex > MAX_REGEX_RULES) throw new Error(`${id}: ${regex} regex rules, Chrome allows ${MAX_REGEX_RULES}`);
  }
  for (const id of EXTRA_RULESETS) {
    counts[id] = JSON.parse(readFileSync(`${OUT}/${id}.json`, 'utf8')).length;
  }
  // Every ruleset can be on at once, so their sum must fit Chrome's guaranteed
  // static rule count (beyond it, enabling a ruleset can fail on some machines).
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`static rules if every list is on: ${total} of ${MAX_STATIC_RULES}`);
  if (total >= MAX_STATIC_RULES) throw new Error(`rulesets total ${total} rules, over Chrome's ${MAX_STATIC_RULES}`);
}

function buildCosmetics(lines) {
  for (const [group, names] of Object.entries(GROUPS)) {
    const engine = FiltersEngine.parse(names.flatMap(n => lines[n]).filter(isCosmeticLine).join('\n'), {
      loadNetworkFilters: false,
      loadCosmeticFilters: true,
      loadGenericCosmeticsFilters: true,
      loadExtendedSelectors: true,
    });
    const bin = engine.serialize();
    writeFileSync(`${OUT}/cosmetic-${group}.bin`, bin);
    console.log(`cosmetic-${group}.bin: ${bin.length} bytes`);
  }
}

function buildScriptlets(lines, table) {
  const matches = {};
  for (const [group, names] of Object.entries(GROUPS)) {
    const sources = names.map(n => ({ lines: lines[n].filter(isScriptletLine), trusted: Boolean(SOURCES[n].trusted) }));
    const { data, matches: patterns, skipped } = buildScriptletData(sources, table);
    const bytes = writeJson(`${OUT}/scriptlets-${group}.json`, data);
    matches[group] = patterns;
    console.log(`scriptlets-${group}.json: ${data.filters.length} filters, ${data.calls.length} calls, `
      + `${Object.keys(data.domains).length} domains, ${bytes} bytes; skipped ${JSON.stringify(skipped)}`);
  }
  writeJson(`${OUT}/scriptlet-matches.json`, matches);
}

mkdirSync(OUT, { recursive: true });
const { lines, meta } = await fetchSources();
const scriptlets = await fetchScriptlets();
await buildRulesets(lines);
buildCosmetics(lines);
buildScriptlets(lines, scriptlets.table);
rmSync(`${OUT}/cosmetic.bin`, { force: true }); // replaced by cosmetic-<group>.bin
writeJson(`${OUT}/sources.json`, {
  fetched: new Date().toISOString().slice(0, 10),
  lists: meta,
  scriptlets: scriptlets.meta,
});
