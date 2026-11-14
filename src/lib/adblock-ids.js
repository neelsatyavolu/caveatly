// Shared by tools/build-filters.mjs and the service worker.
// Static rulesets number block rules from 1 and allow rules from ALLOW_ID_BASE.
export const ALLOW_ID_BASE = 1_000_000;
// Chrome caps regex rules per ruleset; keep each list's under it.
export const MAX_REGEX_RULES = 1000;
// Chrome's guaranteed static rule count (GUARANTEED_MINIMUM_STATIC_RULES). All
// rulesets can be enabled together, so the build keeps their sum below it.
export const MAX_STATIC_RULES = 30000;
// Rulesets declared in manifest.json, grouped by the setting that enables them.
export const AD_RULESETS = ['easylist', 'reuters'];
export const TRACKER_RULESETS = ['easyprivacy'];
export const COOKIE_RULESETS = ['cookies'];
export const ANNOYANCE_RULESETS = ['annoyances'];
// Element-hiding engines (filters/cosmetic-<group>.bin) and scriptlet tables
// (filters/scriptlets-<group>.json), keyed by the setting that enables them.
export const FILTER_GROUPS = {
  ads: 'blockAds',
  cookies: 'blockCookieNotices',
  annoyances: 'blockAnnoyances',
};
