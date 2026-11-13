// Service-worker side of link cleaning:
// - "minimize": a declarativeNetRequest rule strips tracking parameters from
//   page and frame navigations,
// - "unwrapLinks": registers the link-unwrap content script (rewrites
//   google.com/url, l.facebook.com, ... links to their destination before the
//   click lands) plus DNR fallbacks for wrapper URLs opened directly whose
//   target is not URL-encoded (DNR cannot decode).
import { getSettings } from './settings.js';
import { TRACKING_PARAMS, PROTECTED_DOMAINS, PROTECTED_URL_REGEX, WRAPPERS } from './link-rules.js';

export { stripTrackingParams, unwrapUrl, isProtectedUrl, TRACKING_PARAMS } from './link-rules.js';

// Same id the old background.js rule used, so existing installs replace it in place.
const PARAM_RULE_ID = 1002;
const PROTECT_RULE_ID = 4100;
const UNWRAP_RULE_BASE = 4110;
const UNWRAP_RULE_IDS = WRAPPERS.map((_, i) => UNWRAP_RULE_BASE + i);
// Above the ad-blocking pause rule (100000, lib/adblock.js) so pausing a site
// keeps links clean there, but just below the other privacy rules (200000):
// the sign-in "allow" rule below then only overrides our own stripping and the
// filter lists, never GPC or other features' rules on login pages.
const LINK_RULE_PRIORITY = 199000;
const NAV_TYPES = ['main_frame', 'sub_frame'];
// Not "caveatly-": lib/adblock.js unregisters every script with that prefix.
const UNWRAP_SCRIPT_ID = 'linkclean-unwrap';

function paramRules() {
  return [
    {
      id: PARAM_RULE_ID,
      priority: LINK_RULE_PRIORITY,
      action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: TRACKING_PARAMS } } } },
      condition: { urlFilter: '*', resourceTypes: NAV_TYPES, excludedRequestDomains: PROTECTED_DOMAINS },
    },
    {
      // DNR has no path exclusions; an allow rule at the same priority wins
      // over the redirect, so sign-in, OAuth, SSO and checkout URLs are untouched.
      id: PROTECT_RULE_ID,
      priority: LINK_RULE_PRIORITY,
      action: { type: 'allow' },
      condition: { regexFilter: PROTECTED_URL_REGEX, isUrlFilterCaseSensitive: false, resourceTypes: NAV_TYPES },
    },
  ];
}

// Only targets without %, + or & are taken: those need no decoding, so the
// regex capture is exactly what the wrapper would have redirected to.
function fallbackRegex(wrapper) {
  const prefix = `^https?://${wrapper.host}(?::[0-9]+)?${wrapper.path}\\?`;
  if (wrapper.wholeQuery) return `${prefix}(https?://[^%]+)$`;
  const names = wrapper.params.join('|');
  return `${prefix}(?:[^#]*&)?(?:${names})=(https?://[^&%+#]+)(?:[&#].*)?$`;
}

function unwrapRules() {
  return WRAPPERS
    .map((wrapper, i) => ({ wrapper, id: UNWRAP_RULE_IDS[i] }))
    .filter(({ wrapper }) => !wrapper.trailer) // Disqus' ":hash" suffix needs code to remove
    .map(({ wrapper, id }) => ({
      id,
      priority: LINK_RULE_PRIORITY,
      action: { type: 'redirect', redirect: { regexSubstitution: '\\1' } },
      condition: { regexFilter: fallbackRegex(wrapper), isUrlFilterCaseSensitive: false, resourceTypes: NAV_TYPES },
    }));
}

async function applyRules(settings) {
  const addRules = [
    ...(settings.minimize ? paramRules() : []),
    ...(settings.unwrapLinks ? unwrapRules() : []),
  ];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PARAM_RULE_ID, PROTECT_RULE_ID, ...UNWRAP_RULE_IDS],
    addRules,
  });
}

async function applyUnwrapScript(enabled) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [UNWRAP_SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [UNWRAP_SCRIPT_ID] });
  if (!enabled) return;
  await chrome.scripting.registerContentScripts([{
    id: UNWRAP_SCRIPT_ID,
    js: ['link-unwrap.js'],
    matches: ['http://*/*', 'https://*/*'],
    excludeMatches: PROTECTED_DOMAINS.map(d => `*://*.${d}/*`),
    allFrames: true,
    runAt: 'document_start',
    persistAcrossSessions: true,
  }]);
}

// Several toggles can flip in quick succession; run one sync at a time.
let syncQueue = Promise.resolve();

export function applyLinkCleaningSettings() {
  syncQueue = syncQueue.then(async () => {
    const settings = await getSettings();
    await applyRules(settings);
    await applyUnwrapScript(settings.unwrapLinks);
  }).catch(err => console.error('[caveatly] could not apply link-cleaning settings', err));
  return syncQueue;
}

export function initLinkCleaning() {
  chrome.runtime.onInstalled.addListener(() => applyLinkCleaningSettings());
  chrome.runtime.onStartup.addListener(() => applyLinkCleaningSettings());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.minimize || changes.unwrapLinks)) applyLinkCleaningSettings();
  });
}
