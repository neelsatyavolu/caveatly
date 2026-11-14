// Embedded builds (e.g. Caveatly bundled inside the Perch browser) turn parts of
// Caveatly off through a block in manifest.json, written by the host at packaging:
//   "caveatly_embed": { "telemetry": false, "blocker": false, "hide": ["gpc", "cookieGuard"] }
// "hide" drops single features the host already provides (off and not shown).
// Read synchronously from the manifest (never storage) so the switches hold from
// the first service-worker wake. Without the block, everything behaves as normal.

function embedBlock() {
  try {
    const block = chrome.runtime.getManifest().caveatly_embed;
    return block && typeof block === 'object' ? block : {};
  } catch {
    return {};
  }
}

const EMBED = embedBlock();

/** False only when the host set telemetry:false: no heartbeat, no uninstall URL. */
export const TELEMETRY_ALLOWED = EMBED.telemetry !== false;

/** False only when the host set blocker:false: Caveatly is the fine-print grader only. */
export const BLOCKER_ALLOWED = EMBED.blocker !== false;

/** The host extension's id when it runs the ad blocker's on/off and site list
 *  (controller:"<extension id>"), else null. See lib/controller.js. */
export const CONTROLLER_ID = BLOCKER_ALLOWED && /^[a-p]{32}$/.test(EMBED.controller || '') ? EMBED.controller : null;

// Features a host can hide one by one, and the settings each one turns off.
const HIDEABLE = { gpc: ['gpc'], cookieGuard: ['block', 'autoReject'] };
const HIDDEN = new Set(Array.isArray(EMBED.hide) ? EMBED.hide.filter(name => name in HIDEABLE) : []);

/** False when the host hid this feature (or turned the whole blocker off). */
export function featureAllowed(name) {
  return BLOCKER_ALLOWED && !HIDDEN.has(name);
}

// Everything that blocks, hides, rewrites or changes browser privacy settings.
// With blocker:false these read as off whatever is stored.
export const BLOCKER_SETTINGS = [
  'adblockOn', 'blockAds', 'blockTrackers', 'blockCookieNotices', 'blockAnnoyances',
  'disableAdApis', 'blockThirdPartyCookies', 'protectWebRtc', 'blockPings', 'hardenChromeServices',
  'minimize', 'unwrapLinks', 'gpc', 'block', 'autoReject',
];

/** Applies the embed switches on top of stored settings (returns a new object). */
export function applyEmbed(settings) {
  const forcedOff = [
    ...(TELEMETRY_ALLOWED ? [] : ['usageStats']),
    ...(BLOCKER_ALLOWED ? [] : BLOCKER_SETTINGS),
    ...[...HIDDEN].flatMap(name => HIDEABLE[name]),
  ];
  return forcedOff.reduce((acc, key) => ({ ...acc, [key]: false }), { ...settings });
}
