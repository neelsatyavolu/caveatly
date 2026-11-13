// Shared by tools/build-filters.mjs and the service worker.
// Static rulesets number block rules from 1 and allow rules from ALLOW_ID_BASE.
export const ALLOW_ID_BASE = 1_000_000;
// Chrome caps regex rules per extension; keep EasyList's under it.
export const MAX_REGEX_RULES = 1000;
// Rulesets declared in manifest.json, grouped by the setting that enables them.
export const AD_RULESETS = ['easylist', 'reuters'];
export const TRACKER_RULESETS = ['easyprivacy'];
