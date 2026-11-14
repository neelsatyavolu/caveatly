// Service-worker side of scriptlets (`##+js(...)` filters, e.g. YouTube ads):
// - filters naming exact hostnames run from MAIN-world content scripts that
//   lib/adblock.js registers per filter list (scriptlets/<group>.js), matched
//   to those hostnames, so they run at document_start before page scripts;
// - entity filters (`google.*`) cannot be written as match patterns, so they are
//   injected here when the frame's element-hiding script checks in, with
//   executeScript(world: MAIN, injectImmediately). That is early but not
//   guaranteed to beat inline page scripts.
// uBO's scriptlet code is passed as a function, not a string, so the page's CSP
// does not apply to it.
import { getPublicSuffix } from 'tldts-experimental';
import { run } from '../filters/ubo-scriptlets.js';
import { FILTER_GROUPS } from './adblock-ids.js';
import { callsForEntity } from './scriptlet-match.js';

// Inside lib/adblock.js's 'caveatly-' namespace, so pausing and teardown cover it.
export const SCRIPTLET_PREFIX = 'caveatly-scriptlets-';

export function enabledGroups(settings) {
  return Object.entries(FILTER_GROUPS).filter(([, key]) => settings[key]).map(([group]) => group);
}

async function loadJson(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// Loaded lazily and kept for the worker's lifetime; a failed load is retried next time.
const cache = new Map();
function cached(path) {
  if (!cache.has(path)) {
    cache.set(path, loadJson(path).catch(err => {
      cache.delete(path);
      throw err;
    }));
  }
  return cache.get(path);
}

/** Content-script registrations for the MAIN-world scriptlet bundles of the enabled lists. */
export async function scriptletContentScripts(settings, base) {
  const groups = enabledGroups(settings);
  if (!groups.length) return [];
  const matches = await cached('filters/scriptlet-matches.json');
  return groups.filter(group => matches[group]?.length).map(group => ({
    ...base,
    id: `${SCRIPTLET_PREFIX}${group}`,
    js: [`scriptlets/${group}.js`],
    matches: matches[group],
    world: 'MAIN',
    allFrames: true,
    matchOriginAsFallback: true, // about:blank / srcdoc frames of those sites
  }));
}

function hostWithoutSuffix(hostname) {
  const suffix = getPublicSuffix(hostname);
  if (!suffix || suffix === hostname) return null;
  return hostname.slice(0, -(suffix.length + 1));
}

/** Injects entity-filter scriptlets (`google.*`) for one frame of an enabled list. */
export async function injectEntityScriptlets(sender, hostname, groups) {
  const bare = hostWithoutSuffix(hostname);
  if (!bare || !groups.length) return;
  const tables = await Promise.all(groups.map(group => cached(`filters/scriptlets-${group}.json`)));
  const calls = tables.flatMap(data => callsForEntity(data, hostname, bare));
  if (!calls.length) return;
  const target = sender.documentId
    ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
    : { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] };
  await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    injectImmediately: true,
    func: run,
    args: [{}, calls],
  });
}
