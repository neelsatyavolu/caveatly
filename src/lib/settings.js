import { applyEmbed, CONTROLLER_ID } from './embed.js';

// Shared settings model. Preferences live in chrome.storage.sync; API keys stay
// in chrome.storage.local (never synced off this machine).
export const DEFAULT_SETTINGS = {
  block: true,       // block non-essential cookies (consent handler: prefer "necessary only")
  autoReject: true,  // dismiss consent banners (consent handler: prefer "reject all")
  minimize: true,    // strip tracking parameters from navigations (lib/link-cleaning.js)
  gpc: true,         // send Global Privacy Control header
  // On-page only (never when opening the toolbar popup):
  // 'off'  — never prompt or scan from the page
  // 'ask'  — toast when terms/privacy are found on an unscanned domain (default)
  // 'auto' — scan immediately when terms/privacy are found on an unscanned domain
  pageScan: 'ask',
  usageStats: true,  // daily anonymous heartbeat to analytics.n3el.dev (see lib/heartbeat.js)
  adblockOn: true,      // master switch for the ad blocker: off turns the four lists below off without losing them
  blockAds: true,       // EasyList network rules + element hiding, sponsored results, Reuters
  blockTrackers: true,  // EasyPrivacy network rules
  pausedSites: [],      // hostnames (no www.) where ad and tracker blocking is off
  // Reserved for the features being built in parallel (see each module for behavior):
  blockCookieNotices: true,  // EasyList Cookie List: hide cookie notices the consent guard can't click
  blockAnnoyances: false,    // Fanboy Annoyances/Social: newsletter popups, social widgets, chat bubbles
  disableAdApis: true,       // chrome.privacy: Topics, Protected Audience (FLEDGE), ad measurement off
  blockThirdPartyCookies: false, // chrome.privacy: can break some sign-ins, so opt-in
  protectWebRtc: true,       // chrome.privacy: stop WebRTC from exposing local/private IPs
  blockPings: true,          // hyperlink auditing (<a ping>) off + DNR block of 'ping' requests
  unwrapLinks: true,         // skip tracking redirects (google.com/url, l.facebook.com, ...)
  hardenChromeServices: false, // chrome.privacy: no error-page/spelling/extended-reporting uploads, no prefetch (lib/browser-privacy.js)
};

// Gemini via the OpenAI-compatible chat-completions protocol. maxInputChars is
// how much extracted legal text we send (1M context takes whole docs).
export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash-lite',
    maxInputChars: 200000,
    keyHint: 'AIza… from aistudio.google.com',
  },
};
export const DEFAULT_PROVIDER = 'gemini';

// What the ad blocker master switch (adblockOn) turns off.
export const ADBLOCK_KEYS = ['blockAds', 'blockTrackers', 'blockCookieNotices', 'blockAnnoyances'];

// Last { on, sitesOff } from a host extension that runs the ad blocker (lib/controller.js).
export const CONTROLLER_STATE_KEY = 'controllerState';

async function controllerOverrides() {
  if (!CONTROLLER_ID) return {};
  const { [CONTROLLER_STATE_KEY]: state } = await chrome.storage.local.get(CONTROLLER_STATE_KEY);
  return state ? { adblockOn: state.on, pausedSites: state.sitesOff } : {};
}

/** Stored settings as the settings screen shows them (each toggle's own value). */
export async function getStoredSettings() {
  const [stored, controlled] = await Promise.all([chrome.storage.sync.get(DEFAULT_SETTINGS), controllerOverrides()]);
  // Embedded builds force some features off regardless of storage (lib/embed.js).
  return applyEmbed({ ...DEFAULT_SETTINGS, ...stored, ...controlled });
}

/** Settings in effect: with the ad blocker switched off, its lists read as off. */
export async function getSettings() {
  const settings = await getStoredSettings();
  if (settings.adblockOn) return settings;
  return ADBLOCK_KEYS.reduce((acc, key) => ({ ...acc, [key]: false }), settings);
}

export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
}

/** Resolved AI config: Gemini preset + stored key, with test overrides applied. */
export async function getApiConfig() {
  const stored = await chrome.storage.local.get(['apiKeys', 'apiKey', 'apiBase', 'model']);
  const apiKeys = { ...(stored.apiKeys || {}) };
  // legacy single-key field → gemini
  if (stored.apiKey && !apiKeys.gemini) apiKeys.gemini = stored.apiKey;
  const provider = DEFAULT_PROVIDER;
  const preset = PROVIDERS[provider];
  return {
    provider,
    apiKeys,
    apiKey: apiKeys.gemini || '',
    apiBase: stored.apiBase || preset.base,
    model: stored.model || preset.model,
    maxInputChars: preset.maxInputChars,
    maxOutputTokens: preset.maxOutputTokens,
  };
}

export async function saveApiKey(provider, apiKey) {
  const { apiKeys = {} } = await chrome.storage.local.get('apiKeys');
  // Always store under gemini; ignore other provider ids from old UI.
  await chrome.storage.local.set({
    provider: DEFAULT_PROVIDER,
    apiKeys: { ...apiKeys, gemini: apiKey.trim() },
  });
}

export async function saveProvider() {
  await chrome.storage.local.set({ provider: DEFAULT_PROVIDER });
}
