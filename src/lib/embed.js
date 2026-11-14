// Embedded builds (e.g. Caveatly bundled inside the Perch browser) turn parts of
// Caveatly off through a block in manifest.json, written by the host at packaging:
//   "caveatly_embed": { "telemetry": false, "blocker": false }
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

// Everything that blocks, hides, rewrites or changes browser privacy settings.
// With blocker:false these read as off whatever is stored.
export const BLOCKER_SETTINGS = [
  'blockAds', 'blockTrackers', 'blockCookieNotices', 'blockAnnoyances',
  'disableAdApis', 'blockThirdPartyCookies', 'protectWebRtc', 'blockPings', 'hardenChromeServices',
  'minimize', 'unwrapLinks', 'gpc', 'block', 'autoReject',
];

/** Applies the embed switches on top of stored settings (returns a new object). */
export function applyEmbed(settings) {
  const forcedOff = [
    ...(TELEMETRY_ALLOWED ? [] : ['usageStats']),
    ...(BLOCKER_ALLOWED ? [] : BLOCKER_SETTINGS),
  ];
  return forcedOff.reduce((acc, key) => ({ ...acc, [key]: false }), { ...settings });
}
