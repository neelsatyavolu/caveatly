// Service-worker side of ad blocking:
// - turns the static rulesets (EasyList, EasyPrivacy, Reuters) on or off,
// - pauses blocking on sites the user picked (one allowAllRequests rule),
// - registers the content scripts (element hiding, sponsored results, Reuters),
// - answers the element-hiding script with cosmetic filters for its frame,
// - counts blocked requests per tab for the popup.
import { FiltersEngine } from '@ghostery/adblocker';
import { getDomain } from 'tldts-experimental';
import { ALLOW_ID_BASE, AD_RULESETS, TRACKER_RULESETS } from './adblock-ids.js';
import { getSettings } from './settings.js';

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

function contentScriptsFor(settings) {
  if (!settings.blockAds) return [];
  const excludeMatches = excludeFor(settings.pausedSites);
  const base = { runAt: 'document_start', excludeMatches, persistAcrossSessions: true };
  return [
    { ...base, id: `${SCRIPT_PREFIX}cosmetics`, js: ['adblock.js'], matches: ['http://*/*', 'https://*/*'], allFrames: true },
    {
      ...base,
      id: `${SCRIPT_PREFIX}sponsored`,
      css: ['content/sponsored.css'],
      js: ['content/sponsored.js'],
      matches: ['https://www.amazon.com/*', 'https://www.google.com/search*'],
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

async function applyRulesets(settings) {
  const enable = [...(settings.blockAds ? AD_RULESETS : []), ...(settings.blockTrackers ? TRACKER_RULESETS : [])];
  const disable = [...AD_RULESETS, ...TRACKER_RULESETS].filter(id => !enable.includes(id));
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });
}

async function applyPauseRule(pausedSites) {
  const addRules = pausedSites.length ? [{
    id: PAUSE_RULE_ID,
    priority: PAUSE_PRIORITY,
    action: { type: 'allowAllRequests' },
    condition: { requestDomains: pausedSites, resourceTypes: ['main_frame'] },
  }] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PAUSE_RULE_ID], addRules });
}

async function applyContentScripts(settings) {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ours = registered.filter(s => s.id.startsWith(SCRIPT_PREFIX)).map(s => s.id);
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
  const scripts = contentScriptsFor(settings);
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
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

// ————— Element hiding —————

let enginePromise = null;

function loadEngine() {
  enginePromise ??= fetch(chrome.runtime.getURL('filters/cosmetic.bin'))
    .then(res => res.arrayBuffer())
    .then(buf => FiltersEngine.deserialize(new Uint8Array(buf)))
    .catch(err => {
      enginePromise = null; // retry on the next request
      throw err;
    });
  return enginePromise;
}

function asStrings(value) {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
}

export async function cosmeticsFor(msg, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null || !sender.url || !/^https?:/.test(sender.url)) return INACTIVE;
  const settings = await getSettings();
  const topHost = sender.tab.url ? new URL(sender.tab.url).hostname : '';
  if (!settings.blockAds || isPausedHost(topHost, settings.pausedSites)) return INACTIVE;

  const { hostname } = new URL(sender.url);
  const start = msg.lifecycle === 'start';
  const engine = await loadEngine();
  const { styles, extended } = engine.getCosmeticsFilters({
    url: sender.url,
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
  });
  if (styles) {
    // USER origin so page styles cannot override the hiding rules.
    await chrome.scripting.insertCSS({
      target: { tabId, frameIds: [sender.frameId ?? 0] },
      css: styles,
      origin: 'USER',
    }).catch(() => {}); // frame may be gone already
  }
  return { active: true, scripts: [], styles: '', extended: extended || [] };
}

// ————— Popup status —————

const COUNTED_RULESETS = new Set([...AD_RULESETS, ...TRACKER_RULESETS]);

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
  const enabled = settings.blockAds || settings.blockTrackers;
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
