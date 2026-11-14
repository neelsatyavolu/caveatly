// Service-worker side of ad blocking:
// - turns the static rulesets (EasyList, EasyPrivacy, Reuters, cookie notices,
//   annoyances) on or off,
// - pauses blocking on sites the user picked (one allowAllRequests rule),
// - registers the content scripts (element hiding, sponsored results, Reuters,
//   scriptlets),
// - answers the element-hiding script with cosmetic filters for its frame,
//   merged from the enabled lists,
// - counts blocked requests per tab for the popup.
import { FiltersEngine } from '@ghostery/adblocker';
import { getDomain } from 'tldts-experimental';
import { ALLOW_ID_BASE, AD_RULESETS, TRACKER_RULESETS, COOKIE_RULESETS, ANNOYANCE_RULESETS } from './adblock-ids.js';
import { SCRIPTLET_PREFIX, enabledGroups, scriptletContentScripts, injectEntityScriptlets } from './adblock-scriptlets.js';
import { SPONSORED_MATCHES } from './sponsored-matches.js';
import { getSettings } from './settings.js';
import { featureAllowed } from './embed.js';

const PAUSE_RULE_ID = 2001;
// Above every list rule (abp2dnr uses 1000 for blocks, 2000 for exceptions).
const PAUSE_PRIORITY = 100000;
const SCRIPT_PREFIX = 'caveatly-';
const INACTIVE = { active: false, scripts: [], styles: '', extended: [] };

export function siteKey(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function isPausedHost(hostname, pausedSites) {
  const host = siteKey(hostname);
  return pausedSites.some(site => host === site || host.endsWith(`.${site}`));
}

function excludeFor(pausedSites) {
  return pausedSites.flatMap(site => [`*://${site}/*`, `*://*.${site}/*`]);
}

function contentScriptBase(settings) {
  return { runAt: 'document_start', excludeMatches: excludeFor(settings.pausedSites), persistAcrossSessions: true };
}

function contentScriptsFor(settings) {
  const base = contentScriptBase(settings);
  // Element hiding serves every enabled list (cookie notices can be on with ads off),
  // unless the host hides elements itself (caveatly_embed.hide "cosmetics").
  const cosmetics = enabledGroups(settings).length && featureAllowed('cosmetics') ? [{
    ...base,
    id: `${SCRIPT_PREFIX}cosmetics`,
    js: ['adblock.js'],
    matches: ['http://*/*', 'https://*/*'],
    allFrames: true,
    // Also about:blank / srcdoc / blob: frames, where ad scripts often write
    // their ads; they are matched by the origin that created them.
    matchOriginAsFallback: true,
  }] : [];
  if (!settings.blockAds) return cosmetics;
  return [
    ...cosmetics,
    {
      ...base,
      id: `${SCRIPT_PREFIX}sponsored`,
      css: ['content/sponsored.css'],
      js: ['content/sponsored.js'],
      matches: SPONSORED_MATCHES,
    },
    { ...base, id: `${SCRIPT_PREFIX}reuters-css`, css: ['content/reuters.css'], matches: ['*://*.reuters.com/*'] },
    {
      ...base,
      id: `${SCRIPT_PREFIX}reuters-stub`,
      js: ['content/reuters-bootstrap.js'],
      matches: ['*://*.reuters.com/*'],
      world: 'MAIN',
    },
  ];
}

const RULESETS_BY_SETTING = [
  ['blockAds', AD_RULESETS],
  ['blockTrackers', TRACKER_RULESETS],
  ['blockCookieNotices', COOKIE_RULESETS],
  ['blockAnnoyances', ANNOYANCE_RULESETS],
];
const ALL_RULESETS = RULESETS_BY_SETTING.flatMap(([, ids]) => ids);

async function applyRulesets(settings) {
  const enable = RULESETS_BY_SETTING.flatMap(([key, ids]) => (settings[key] ? ids : []));
  const disable = ALL_RULESETS.filter(id => !enable.includes(id));
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });
}

async function applyPauseRule(pausedSites) {
  const addRules = pausedSites.length ? [{
    id: PAUSE_RULE_ID,
    priority: PAUSE_PRIORITY,
    action: { type: 'allowAllRequests' },
    condition: { requestDomains: pausedSites, resourceTypes: ['main_frame', 'sub_frame'] },
  }] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PAUSE_RULE_ID], addRules });
}

// The fields we set, with Chrome's defaults filled in, to compare a wanted
// registration with the one Chrome reports.
const patternSet = list => [...new Set(list || [])].sort(); // Chrome reports patterns sorted, deduplicated

function registrationKey(script) {
  return JSON.stringify([
    script.js || [], script.css || [], patternSet(script.matches), patternSet(script.excludeMatches),
    script.runAt || 'document_idle', Boolean(script.allFrames), script.world || 'ISOLATED',
    Boolean(script.matchOriginAsFallback),
  ]);
}

// Re-registers only what changed: the scriptlet scripts carry tens of
// thousands of match patterns, and re-registering them on every toggle takes
// seconds during which they would not run.
async function syncContentScripts(wanted, registered) {
  const wantedKeys = new Map(wanted.map(s => [s.id, registrationKey(s)]));
  const stale = registered.filter(s => wantedKeys.get(s.id) !== registrationKey(s)).map(s => s.id);
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  const kept = new Set(registered.map(s => s.id).filter(id => !stale.includes(id)));
  const missing = wanted.filter(s => !kept.has(s.id));
  if (missing.length) await chrome.scripting.registerContentScripts(missing);
}

async function applyContentScripts(settings) {
  const registered = (await chrome.scripting.getRegisteredContentScripts()).filter(s => s.id.startsWith(SCRIPT_PREFIX));
  const isScriptlet = s => s.id.startsWith(SCRIPTLET_PREFIX);
  await syncContentScripts(contentScriptsFor(settings), registered.filter(s => !isScriptlet(s)));
  // Separately, so a bad scriptlet registration cannot take element hiding down with it.
  try {
    const scriptlets = await scriptletContentScripts(settings, contentScriptBase(settings));
    await syncContentScripts(scriptlets, registered.filter(isScriptlet));
  } catch (err) {
    console.error('[caveatly] could not register scriptlets', err);
  }
}

// Settings can change in quick succession (several toggles); run one sync at a time.
let syncQueue = Promise.resolve();

export function applyAdblockSettings() {
  syncQueue = syncQueue.then(async () => {
    const settings = await getSettings();
    await applyRulesets(settings);
    await applyPauseRule(settings.pausedSites);
    await applyContentScripts(settings);
  }).catch(err => console.error('[caveatly] could not apply ad-blocking settings', err));
  return syncQueue;
}

// Script-written about:blank frames (see src/adblock.js): run element hiding
// in the tab's frames again; frames that already run it skip themselves.
async function reinjectCosmetics(sender) {
  await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, allFrames: true },
    files: ['adblock.js'],
    injectImmediately: true,
  });
}

// Wired here rather than in background.js: the cookie-notice and annoyance
// toggles, and the element-hiding script's request to cover rewritten frames.
export function initAdblockLists() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.blockCookieNotices || changes.blockAnnoyances)) applyAdblockSettings();
  });
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== 'cosmeticsFrames' || sender.id !== chrome.runtime.id || sender.tab?.id == null) return false;
    reinjectCosmetics(sender).catch(err => console.error('[caveatly] could not cover rewritten frames', err));
    return false;
  });
}

// ————— Element hiding —————

// One engine per list group (filters/cosmetic-<group>.bin), loaded on first use.
const engines = new Map();

function loadEngine(group) {
  if (!engines.has(group)) {
    engines.set(group, fetch(chrome.runtime.getURL(`filters/cosmetic-${group}.bin`))
      .then(res => {
        if (!res.ok) throw new Error(`cosmetic-${group}.bin: HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then(buf => FiltersEngine.deserialize(new Uint8Array(buf)))
      .catch(err => {
        engines.delete(group); // retry on the next request
        throw err;
      }));
  }
  return engines.get(group);
}

function asStrings(value) {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
}

const isWebUrl = url => /^https?:/.test(url || '');

// about:blank / srcdoc frames report that as their URL; filter them as the
// page that created them (their origin), like uBO and Ghostery do.
function frameUrl(sender) {
  if (isWebUrl(sender.url)) return sender.url;
  return isWebUrl(sender.origin) ? `${sender.origin}/` : null;
}

function cosmeticsFrom(engine, query) {
  const { styles, extended } = engine.getCosmeticsFilters(query);
  return { styles: styles || '', extended: extended || [] };
}

export async function cosmeticsFor(msg, sender) {
  const tabId = sender.tab?.id;
  const url = frameUrl(sender);
  if (tabId == null || !url) return INACTIVE;
  const settings = await getSettings();
  const topHost = sender.tab.url ? new URL(sender.tab.url).hostname : '';
  const groups = enabledGroups(settings);
  if (!groups.length || isPausedHost(topHost, settings.pausedSites)) return INACTIVE;

  const { hostname } = new URL(url);
  const start = msg.lifecycle === 'start';
  if (start) {
    injectEntityScriptlets(sender, hostname, groups)
      .catch(err => console.error('[caveatly] could not inject scriptlets', err));
  }
  const query = {
    url,
    hostname,
    domain: getDomain(hostname) || hostname,
    classes: asStrings(msg.classes),
    hrefs: asStrings(msg.hrefs),
    ids: asStrings(msg.ids),
    getBaseRules: start,
    getRulesFromHostname: start,
    getRulesFromDOM: !start,
    getInjectionRules: false,
    getExtendedRules: true,
  };
  const results = await Promise.all(groups.map(async group => cosmeticsFrom(await loadEngine(group), query)));
  const styles = results.map(r => r.styles).filter(Boolean).join('\n');
  const extended = results.flatMap(r => r.extended);
  if (styles) {
    // USER origin so page styles cannot override the hiding rules.
    await chrome.scripting.insertCSS({
      target: { tabId, frameIds: [sender.frameId ?? 0] },
      css: styles,
      origin: 'USER',
    }).catch(() => {}); // frame may be gone already
  }
  return { active: true, scripts: [], styles: '', extended };
}

// ————— Popup status —————

const COUNTED_RULESETS = new Set(ALL_RULESETS);

async function blockedCount(tabId) {
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    return rulesMatchedInfo.filter(m => COUNTED_RULESETS.has(m.rule.rulesetId) && m.rule.ruleId < ALLOW_ID_BASE).length;
  } catch {
    return null;
  }
}

export async function adblockStatus(tabId, url) {
  const settings = await getSettings();
  const enabled = settings.blockAds || settings.blockTrackers || settings.blockCookieNotices || settings.blockAnnoyances;
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { /* no page */ }
  const paused = isPausedHost(hostname, settings.pausedSites);
  return { enabled, paused, blocked: enabled && !paused ? await blockedCount(tabId) : null };
}

export async function setSitePaused(hostname, paused) {
  const site = siteKey(hostname);
  if (!site) return;
  const { pausedSites } = await getSettings();
  const rest = pausedSites.filter(s => s !== site);
  await chrome.storage.sync.set({ pausedSites: paused ? [...rest, site] : rest });
}
