// Refreshes the ad-blocking data in src/filters/ from EasyList and EasyPrivacy:
//   easylist.json / easyprivacy.json  declarativeNetRequest rulesets (network blocking)
//   cosmetic.bin                      serialized Ghostery engine (element hiding)
// Run with `npm run filters`, review the diff, then `npm run build`.
// Block rules get ids below ALLOW_ID_BASE and allow rules ids from it upward,
// so the popup can count blocked requests without loading the rulesets.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { FiltersEngine } from '@ghostery/adblocker';
import { ALLOW_ID_BASE, MAX_REGEX_RULES } from '../src/lib/adblock-ids.js';

const require = createRequire(import.meta.url);
const { convertFilter } = require('@eyeo/abp2dnr');

const LISTS = {
  easylist: 'https://easylist.to/easylist/easylist.txt',
  easyprivacy: 'https://easylist.to/easylist/easyprivacy.txt',
};
const OUT = 'src/filters';
// Cosmetic (##, #@#, #?#, #$#) and scriptlet lines are handled by the Ghostery engine.
const NETWORK_LINE = /^\s*[^[!\s]/;
const COSMETIC_LINE = /#[@?$%]?#/;

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith('[Adblock')) throw new Error(`${url} does not look like a filter list`);
  return text;
}

async function toRuleset(text) {
  const rules = [];
  let regexCount = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!NETWORK_LINE.test(line) || COSMETIC_LINE.test(line)) continue;
    let converted;
    try { converted = await convertFilter(line); } catch { continue; }
    for (const rule of converted) {
      if (rule.condition?.regexFilter && ++regexCount > MAX_REGEX_RULES) continue;
      rules.push(rule);
    }
  }
  return numberRules(mergeDomainRules(rules));
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

mkdirSync(OUT, { recursive: true });
const texts = {};
for (const [name, url] of Object.entries(LISTS)) {
  texts[name] = await download(url);
  const rules = await toRuleset(texts[name]);
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(rules));
  console.log(`${name}: ${rules.length} network rules`);
}

const engine = FiltersEngine.parse(texts.easylist, {
  loadNetworkFilters: false,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  loadExtendedSelectors: true,
});
writeFileSync(`${OUT}/cosmetic.bin`, engine.serialize());
console.log(`cosmetic.bin: ${engine.serialize().length} bytes`);
