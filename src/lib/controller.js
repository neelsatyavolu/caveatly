// A host extension (Perch) can run Caveatly's ad blocker from its own settings
// when the packaged manifest names it: "caveatly_embed": { "controller": "<id>" }.
// The host sends { type: 'perch.blocker', on, sitesOff } on every change and in
// reply to our 'caveatly.ready' at startup. The last state is kept in
// chrome.storage.local (never sync) and read by getStoredSettings().
import { CONTROLLER_ID } from './embed.js';
import { applyAdblockSettings, siteKey } from './adblock.js';
import { CONTROLLER_STATE_KEY } from './settings.js';

const MESSAGE_TYPE = 'perch.blocker';
const MAX_SITES = 5000;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A valid controller message as { on, sitesOff }, or null. */
export function parseControllerMessage(msg) {
  if (!msg || msg.type !== MESSAGE_TYPE || typeof msg.on !== 'boolean' || !Array.isArray(msg.sitesOff)) return null;
  const sites = msg.sitesOff
    .filter(site => typeof site === 'string')
    .map(siteKey)
    .filter(site => HOST_RE.test(site));
  return { on: msg.on, sitesOff: [...new Set(sites)].slice(0, MAX_SITES) };
}

async function applyControllerState(state) {
  await chrome.storage.local.set({ [CONTROLLER_STATE_KEY]: state });
  await applyAdblockSettings();
}

async function askController() {
  try {
    const reply = await chrome.runtime.sendMessage(CONTROLLER_ID, { type: 'caveatly.ready' });
    const state = parseControllerMessage(reply);
    if (state) await applyControllerState(state);
  } catch {
    // Host extension off or not answering: keep the last stored state.
  }
}

export function initController() {
  if (!CONTROLLER_ID) return;
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    if (sender.id !== CONTROLLER_ID) return false;
    const state = parseControllerMessage(msg);
    if (!state) return false;
    applyControllerState(state)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, message: err.message }));
    return true;
  });
  chrome.runtime.onInstalled.addListener(() => { askController(); });
  chrome.runtime.onStartup.addListener(() => { askController(); });
}
