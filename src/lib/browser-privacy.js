// Chrome-level privacy settings (chrome.privacy) plus <a ping> blocking.
//
// Each Caveatly setting maps to one or more Chrome prefs. When a setting is on
// we set the protective value; when it is off we call clear(), which drops only
// this extension's override so Chrome's own value (or the user's) returns. We
// never force a pref to the less private value.
//
// Chrome keeps extension-controlled prefs only while the extension is enabled:
// disabling or uninstalling Caveatly reverts every pref set here, and dynamic
// DNR rules stop applying with it, so nothing stays stuck.
import { getSettings } from './settings.js';

// Dynamic DNR ids 3000-3099 belong to this module (1001/1002 privacy rules in
// background.js, 2001 the ad-blocking pause rule).
const PING_RULE_ID = 3001;
// Same priority as the GPC rule: above the per-site ad-blocking pause rule
// (allowAllRequests, 100000), so pausing ads on a site keeps pings blocked.
const PING_RULE_PRIORITY = 200000;

// setting key -> prefs it controls, as [namespace, pref, protective value].
// Prefs missing from this Chrome (older builds, or removed Privacy Sandbox
// APIs) are skipped.
export const BROWSER_PRIVACY_PREFS = {
  disableAdApis: [
    ['websites', 'topicsEnabled', false],
    ['websites', 'fledgeEnabled', false],
    ['websites', 'adMeasurementEnabled', false],
  ],
  blockThirdPartyCookies: [['websites', 'thirdPartyCookiesAllowed', false]],
  protectWebRtc: [['network', 'webRTCIPHandlingPolicy', 'default_public_interface_only']],
  blockPings: [['websites', 'hyperlinkAuditingEnabled', false]],
  // Low-risk hardening: nothing here changes how sites work, and Safe Browsing
  // protection itself is left alone.
  hardenChromeServices: [
    ['services', 'alternateErrorPagesEnabled', false],            // don't send mistyped URLs to Google
    ['services', 'safeBrowsingExtendedReportingEnabled', false],  // don't upload page content on SB hits
    ['services', 'spellingServiceEnabled', false],                // spell-check locally, not via Google
    ['network', 'networkPredictionEnabled', false],               // no preconnect/prefetch to unvisited pages
  ],
};

const FEATURES = Object.keys(BROWSER_PRIVACY_PREFS);
const OURS = new Set(['controllable_by_this_extension', 'controlled_by_this_extension']);

function prefFor([ns, name]) {
  return chrome.privacy?.[ns]?.[name] ?? null;
}

function prefLabel([ns, name]) {
  return `privacy.${ns}.${name}`;
}

async function applyPref(entry, on) {
  const pref = prefFor(entry);
  if (!pref) return;
  try {
    if (!on) {
      await pref.clear({});
      return;
    }
    // Enterprise policy or a higher-precedence extension wins; setting anyway
    // would be ignored at best, so leave it and report it in the status.
    const { levelOfControl } = await pref.get({});
    if (OURS.has(levelOfControl)) await pref.set({ value: entry[2] });
  } catch (err) {
    console.error(`[caveatly] could not update ${prefLabel(entry)}`, err);
  }
}

async function applyPingRule(on) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PING_RULE_ID],
    addRules: on ? [{
      id: PING_RULE_ID,
      priority: PING_RULE_PRIORITY,
      action: { type: 'block' },
      condition: { resourceTypes: ['ping'] },
    }] : [],
  });
}

// Toggles can arrive in quick succession; run one sync at a time.
let syncQueue = Promise.resolve();

export function applyBrowserPrivacy() {
  syncQueue = syncQueue.then(async () => {
    const settings = await getSettings();
    const jobs = FEATURES.flatMap(key =>
      BROWSER_PRIVACY_PREFS[key].map(entry => applyPref(entry, Boolean(settings[key]))));
    await Promise.all(jobs);
    await applyPingRule(Boolean(settings.blockPings));
  }).catch(err => console.error('[caveatly] could not apply browser privacy settings', err));
  return syncQueue;
}

async function readPref(entry) {
  const pref = prefFor(entry);
  if (!pref) return null;
  try {
    const { value, levelOfControl } = await pref.get({});
    return { value, levelOfControl };
  } catch (err) {
    console.error(`[caveatly] could not read ${prefLabel(entry)}`, err);
    return null;
  }
}

async function pingRulePresent() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.some(r => r.id === PING_RULE_ID);
}

// on: every pref Chrome has is at the protective value (and, for pings, the
// DNR rule is in place). controllable: Caveatly is allowed to change all of
// them. controlledByOther: another extension holds at least one. When neither
// is true and controllable is false, an enterprise policy manages it.
async function featureStatus(key) {
  const entries = BROWSER_PRIVACY_PREFS[key];
  const reads = await Promise.all(entries.map(readPref));
  const present = entries.map((entry, i) => ({ entry, read: reads[i] })).filter(p => p.read);
  const prefsOn = present.every(p => p.read.value === p.entry[2]);
  const ruleOn = key === 'blockPings' ? await pingRulePresent() : true;
  // The ping rule works even where Chrome lacks the hyperlink-auditing pref.
  const supported = present.length > 0 || key === 'blockPings';
  return {
    supported,
    on: supported && prefsOn && ruleOn,
    controllable: present.every(p => OURS.has(p.read.levelOfControl)),
    controlledByOther: present.some(p => p.read.levelOfControl === 'controlled_by_other_extensions'),
  };
}

/** { [settingKey]: { supported, on, controllable, controlledByOther } } */
export async function getBrowserPrivacyStatus() {
  const statuses = await Promise.all(FEATURES.map(featureStatus));
  return Object.fromEntries(FEATURES.map((key, i) => [key, statuses[i]]));
}

// Popup or settings page (also when opened in a tab), never a content script.
function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
}

export function initBrowserPrivacy() {
  chrome.runtime.onInstalled.addListener(() => { applyBrowserPrivacy(); });
  chrome.runtime.onStartup.addListener(() => { applyBrowserPrivacy(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && FEATURES.some(key => key in changes)) applyBrowserPrivacy();
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'browserPrivacy:status' || !fromExtensionPage(sender)) return false;
    getBrowserPrivacyStatus()
      .then(status => sendResponse({ ok: true, status }))
      .catch(err => sendResponse({ ok: false, message: err.message }));
    return true;
  });
}
