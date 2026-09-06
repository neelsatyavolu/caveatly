// Shared settings model. Preferences live in chrome.storage.sync; API keys stay
// in chrome.storage.local (never synced off this machine).
export const DEFAULT_SETTINGS = {
  block: true,       // block non-essential cookies (consent handler: prefer "necessary only")
  autoReject: true,  // dismiss consent banners (consent handler: prefer "reject all")
  minimize: false,   // strip tracking parameters from requests
  gpc: true,         // send Global Privacy Control header
  // On-page only (never when opening the toolbar popup):
  // 'off'  — never prompt or scan from the page
  // 'ask'  — toast when terms/privacy are found on an unscanned domain (default)
  // 'auto' — scan immediately when terms/privacy are found on an unscanned domain
  pageScan: 'ask',
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

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
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
