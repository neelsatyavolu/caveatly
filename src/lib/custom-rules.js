// Custom element blocking ("Block element…" in the right-click menu).
// - The context menu injects the element picker into the clicked frame.
// - The picker sends back a CSS selector; we save it per site in
//   chrome.storage.local.customRules as {id, site, selector, createdAt}.
// - content/custom-rules.js runs at document_start in every frame and asks us
//   to insert the site's rules as USER-origin CSS, so page styles can't undo them.
// Custom rules apply even when "Block ads" is off or the site is paused: the
// user picked each element by hand, so the general switches don't cover them.

import { BLOCKER_ALLOWED } from './embed.js';

const STORAGE_KEY = 'customRules';
const MENU_ID = 'caveatly-block-element';
const PICKER_FILES = ['content/picker-selector.js', 'content/picker.js'];
const MAX_SELECTOR_LENGTH = 1000;
const MENU_CONTEXTS = ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'];
const WEB_PAGES = ['http://*/*', 'https://*/*'];

export function siteOf(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function hostOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) ? hostname : '';
  } catch {
    return '';
  }
}

// A rule saved for example.com also covers news.example.com.
function appliesTo(rule, hostname) {
  const host = siteOf(hostname);
  return Boolean(host) && (host === rule.site || host.endsWith(`.${rule.site}`));
}

// Selectors come from our own picker, but check them anyway: an unescaped
// brace would let one rule rewrite the whole stylesheet we insert.
export function isValidSelector(selector) {
  return typeof selector === 'string'
    && selector.trim().length > 0
    && selector.length <= MAX_SELECTOR_LENGTH
    && !/(^|[^\\])[{}]/.test(selector)
    && !selector.includes('/*');
}

// One rule per selector, so a selector Chrome rejects only drops itself.
export function cssFor(selectors) {
  return selectors.map(s => `${s} { display: none !important; }`).join('\n');
}

async function readRules() {
  const { [STORAGE_KEY]: rules } = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(rules) ? rules : [];
}

// Read-modify-write of one storage key: run the writes one at a time.
let writeQueue = Promise.resolve();

function updateRules(change) {
  const next = writeQueue.then(async () => {
    const rules = await readRules();
    const { rules: updated, result } = change(rules);
    if (updated !== rules) await chrome.storage.local.set({ [STORAGE_KEY]: updated });
    return result;
  });
  writeQueue = next.catch(() => {}); // a failed write must not block later ones
  return next;
}

// ————— Functions for the popup / settings UI —————

/** All rules, newest first; with a hostname, only the rules that apply there. */
export async function listCustomRules(hostname) {
  const rules = await readRules();
  const scoped = hostname ? rules.filter(rule => appliesTo(rule, hostname)) : rules;
  return [...scoped].sort((a, b) => b.createdAt - a.createdAt);
}

export function addCustomRule(hostname, selector) {
  const site = siteOf(hostname);
  if (!site) return Promise.reject(new Error('Custom rules only work on web pages.'));
  if (!isValidSelector(selector)) return Promise.reject(new Error('That selector cannot be saved.'));
  const clean = selector.trim();
  return updateRules(rules => {
    const existing = rules.find(r => r.site === site && r.selector === clean);
    if (existing) return { rules, result: existing };
    const rule = { id: crypto.randomUUID(), site, selector: clean, createdAt: Date.now() };
    return { rules: [...rules, rule], result: rule };
  });
}

/** Takes effect on the next page load (CSS already inserted stays until then). */
export function removeCustomRule(id) {
  return updateRules(rules => {
    const kept = rules.filter(r => r.id !== id);
    return { rules: kept.length === rules.length ? rules : kept, result: rules.length - kept.length };
  });
}

/** Removes every rule saved for this site (rules for its parent domain stay). */
export function clearCustomRules(hostname) {
  const site = siteOf(hostname);
  return updateRules(rules => {
    const kept = rules.filter(r => r.site !== site);
    return { rules: kept.length === rules.length ? rules : kept, result: rules.length - kept.length };
  });
}

/** Opens the picker in one frame of a tab (what the context menu does). */
export async function startPicker(tabId, frameId = 0, target = null) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: PICKER_FILES });
  if (target) {
    // Tests and callers without a right-click can name the starting element.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: selector => globalThis.__caveatlyPicker?.select(document.querySelector(selector)),
      args: [target],
    });
  }
}

// ————— Applying rules in pages —————

async function insertRules(target, hostname) {
  const rules = (await readRules()).filter(rule => appliesTo(rule, hostname));
  if (!rules.length) return 0;
  await chrome.scripting.insertCSS({ target, css: cssFor(rules.map(r => r.selector)), origin: 'USER' });
  return rules.length;
}

// Rules belong to the site in the address bar, so every frame of the tab
// (including cross-site iframes) gets the top page's rules.
async function applyToFrame(sender) {
  const tabId = sender.tab?.id;
  const hostname = hostOf(sender.tab?.url);
  if (tabId == null || !hostname) return { ok: true, applied: 0 };
  const applied = await insertRules({ tabId, frameIds: [sender.frameId ?? 0] }, hostname);
  return { ok: true, applied };
}

async function addFromPicker(msg, sender) {
  const tabId = sender.tab?.id;
  const hostname = hostOf(sender.tab?.url);
  if (tabId == null || !hostname) throw new Error('Custom rules only work on web pages.');
  const rule = await addCustomRule(hostname, msg.selector);
  // Hide it right away in every frame of this tab, not just after a reload.
  await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, css: cssFor([rule.selector]), origin: 'USER' })
    .catch(err => console.error('[caveatly] could not apply new custom rule', err));
  return { ok: true, rule };
}

// ————— Wiring —————

function createMenu() {
  chrome.contextMenus.create(
    { id: MENU_ID, title: 'Block element…', contexts: MENU_CONTEXTS, documentUrlPatterns: WEB_PAGES },
    () => {
      // Already exists after an update or a second onInstalled: nothing to do.
      const err = chrome.runtime.lastError;
      if (err && !/duplicate/i.test(err.message || '')) console.error('[caveatly] context menu', err.message);
    },
  );
}

function onMenuClick(info, tab) {
  if (info.menuItemId !== MENU_ID || tab?.id == null) return;
  startPicker(tab.id, info.frameId ?? 0)
    .catch(err => console.error('[caveatly] could not open the element picker', err));
}

const fromExtensionPage = sender =>
  sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
const fromWebPage = sender => sender.id === chrome.runtime.id && Boolean(hostOf(sender.url));

// Content-script messages, then UI messages (extension pages only).
const HANDLERS = {
  'customRules:apply': { allowed: fromWebPage, run: (msg, sender) => (BLOCKER_ALLOWED ? applyToFrame(sender) : { ok: true }) },
  'customRules:add': { allowed: fromWebPage, run: addFromPicker },
  'customRules:list': { allowed: fromExtensionPage, run: async msg => ({ ok: true, rules: await listCustomRules(msg.site) }) },
  'customRules:remove': { allowed: fromExtensionPage, run: async msg => ({ ok: true, removed: await removeCustomRule(msg.id) }) },
  'customRules:clear': { allowed: fromExtensionPage, run: async msg => ({ ok: true, removed: await clearCustomRules(msg.site) }) },
  'customRules:startPicker': {
    allowed: fromExtensionPage,
    run: async msg => {
      if (!BLOCKER_ALLOWED) return { ok: false, message: 'Element blocking is turned off in this build.' };
      await startPicker(msg.tabId, msg.frameId ?? 0, msg.target ?? null);
      return { ok: true };
    },
  },
};

function onMessage(msg, sender, sendResponse) {
  const handler = HANDLERS[msg?.type];
  if (!handler || !handler.allowed(sender)) return undefined; // not ours: let other listeners answer
  handler.run(msg, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, message: err?.message || String(err) }));
  return true; // async response
}

export function initCustomRules() {
  // Embedded grader-only builds have no blocking, so no "Block element…" menu.
  if (!BLOCKER_ALLOWED) {
    chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.remove(MENU_ID, () => void chrome.runtime.lastError));
    chrome.runtime.onMessage.addListener(onMessage);
    return;
  }
  chrome.runtime.onInstalled.addListener(createMenu);
  chrome.contextMenus.onClicked.addListener(onMenuClick);
  chrome.runtime.onMessage.addListener(onMessage);
}
