// Element hiding for ad blocking. Runs at document_start in every frame
// (including about:blank/srcdoc ad frames) and asks the service worker for
// cosmetic filters; the worker injects the stylesheet and returns extended
// (procedural) selectors, which Ghostery's injector applies here.
import { injectCosmetics } from '@ghostery/adblocker-webextension-cosmetics';

const INACTIVE = { active: false, scripts: [], styles: '', extended: [] };

async function getCosmetics(features) {
  try {
    return (await chrome.runtime.sendMessage({ ...features, type: 'cosmetics' })) || INACTIVE;
  } catch {
    return INACTIVE; // worker restarting or extension reloaded: leave the page alone
  }
}

// ————— Late start —————
// Ghostery's injector starts watching the DOM on DOMContentLoaded. A frame we
// reach after that (one an ad script filled with document.open()/write(),
// which also erases window listeners) would never be watched, so report its
// ids, classes and links here instead. Extended selectors are not applied on
// this path; plain CSS hiding covers what ad frames hold.

function features(root) {
  const ids = new Set();
  const classes = new Set();
  const hrefs = new Set();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.id) ids.add(el.id);
    for (const c of el.classList || []) classes.add(c);
    if (el.tagName === 'A' && el.href) hrefs.add(el.href);
  }
  return { ids: [...ids], classes: [...classes], hrefs: [...hrefs] };
}

function startLate() {
  getCosmetics({ lifecycle: 'start', ids: [], classes: [], hrefs: [] });
  const report = root => getCosmetics({ ...features(root), lifecycle: 'dom-update' });
  if (document.documentElement) report(document.documentElement);
  let queued = [];
  new MutationObserver(records => {
    if (!queued.length) setTimeout(() => { const roots = queued; queued = []; roots.forEach(report); }, 100);
    queued = [...queued, ...records.flatMap(r => (r.type === 'attributes' ? [r.target] : [...r.addedNodes]))
      .filter(n => n.nodeType === Node.ELEMENT_NODE)];
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'id'] });
}

// ————— Script-written child frames —————
// Content scripts reach an about:blank frame when it is created, but not the
// document an ad script writes into it afterwards. When such a frame shows up,
// ask the worker to inject this script into the tab's frames again; frames
// that already run it skip (see the guard below).

function isLocalFrame(iframe) {
  const src = iframe.getAttribute('src');
  if (src && !/^(about:|javascript:)/i.test(src)) return false;
  try { return Boolean(iframe.contentDocument); } catch { return false; }
}

function watchWrittenFrames() {
  const frames = document.getElementsByTagName('iframe'); // live
  let seen = 0;
  let timer = null;
  const check = () => {
    timer = null;
    const fresh = [...frames].slice(seen);
    seen = frames.length;
    if (fresh.some(isLocalFrame)) chrome.runtime.sendMessage({ type: 'cosmeticsFrames' }).catch(() => {});
  };
  new MutationObserver(() => {
    if (frames.length > seen && !timer) timer = setTimeout(check, 50);
  }).observe(document, { childList: true, subtree: true });
}

// ————— Start —————

function start() {
  // This script can be injected into a frame again (see watchWrittenFrames).
  // The isolated world's global is ours alone and survives document.open(),
  // so it records the root element we started on: same root (or a start before
  // the root existed) means this frame is already covered; a new root means
  // the document was rewritten and needs watching again.
  const previous = globalThis.caveatlyCosmetics;
  if (previous && (previous.root === null || previous.root === document.documentElement)) return;
  globalThis.caveatlyCosmetics = { root: document.documentElement };
  if (!previous && document.readyState === 'loading') injectCosmetics(window, true, getCosmetics);
  else startLate();
  if (!previous) watchWrittenFrames();
}

start();
