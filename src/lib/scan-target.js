// Explains, in plain words, why a tab cannot be scanned, before or after we try
// to inject into it. Every result is { ok: false, error, message } so the popup
// and the on-page toast can show `message` as-is.
const BROWSER_PAGE = /^(?:chrome|edge|brave|opera|vivaldi|about|chrome-search|chrome-untrusted|devtools|view-source|chrome-extension|moz-extension):/i;
const WEB_STORE = /^https:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)(?:[/?#]|$)/i;

const result = (error, message) => ({ ok: false, error, message });

const BROWSER_PAGE_MSG = "This is a browser page, and Chrome doesn't let extensions read those. Open the website you want to check, then scan it.";
const WEB_STORE_MSG = "Chrome blocks every extension on the Chrome Web Store, so Caveatly can't read this page. Open the developer's own website to check their terms.";
// The manifest asks for http(s) hosts only, so files are never readable.
const FILE_MSG = "Caveatly reads policies on websites, not files on your computer. Open the site's terms or privacy page in the browser instead.";

export function isPdfUrl(url) {
  try { return /\.pdf$/i.test(new URL(url).pathname); } catch { return false; }
}

/**
 * Reason the tab cannot be scanned at all, or null when it is worth trying.
 * Without the "tabs" permission Chrome hides tab.url on pages we have no host
 * access to (chrome://, file://, the Web Store); those are explained from the
 * injection error instead (injectionFailure).
 */
export async function unsupportedTab(tab) {
  const url = tab?.url || '';
  if (!url) return null;
  if (BROWSER_PAGE.test(url)) return result('unsupported-page', BROWSER_PAGE_MSG);
  if (WEB_STORE.test(url)) return result('unsupported-page', WEB_STORE_MSG);
  if (/^file:/i.test(url)) return result('unsupported-page', FILE_MSG);
  if (!/^https?:/i.test(url)) {
    return result('unsupported-page', 'Caveatly can only scan regular web pages (addresses starting with http or https).');
  }
  return null;
}

const BLOCKED_MSG = 'Chrome or your organization blocks extensions on this page, so Caveatly cannot read it.';
// Chrome hides the address of pages we may not read and gives one generic
// error for all of them, so name the usual causes.
const HIDDEN_MSG = "Chrome doesn't let Caveatly read this page. It may be a browser page, a file on your computer, or a site where extensions are blocked. Open the website you want to check, then scan it.";

/** Turns a chrome.scripting injection error into a specific message (raw error in `detail`). */
export function injectionFailure(error, tab) {
  const msg = String(error?.message || error || '');
  const explained = explainInjectionError(msg, tab);
  if (explained.error === 'blocked-page' && !tab?.url) return { ...explained, error: 'unsupported-page', message: HIDDEN_MSG, detail: msg };
  return { ...explained, detail: msg };
}

function explainInjectionError(msg, tab) {
  if (/extensions gallery|web ?store/i.test(msg)) return result('unsupported-page', WEB_STORE_MSG);
  if (/Cannot access a (?:chrome|chrome-extension|chrome-untrusted|devtools|edge|about)[:\w-]*:?\/\/ URL|about:|chrome:\/\//i.test(msg)) {
    return result('unsupported-page', BROWSER_PAGE_MSG);
  }
  if (/file:\/\//i.test(msg)) return result('unsupported-page', FILE_MSG);
  if (/error page/i.test(msg)) {
    return result('page-error', "This page didn't load (the browser is showing an error page). Reload it, then scan again.");
  }
  if (isPdfUrl(tab?.url || '')) {
    return result('pdf-viewer', "Caveatly couldn't read this PDF in Chrome's viewer. Open the site's terms or privacy page as a web page instead.");
  }
  if (/cannot be scripted|cannot access|ExtensionsSettings|runtime_blocked_hosts|policy/i.test(msg)) {
    return result('blocked-page', BLOCKED_MSG);
  }
  if (/No tab with id|tab was closed/i.test(msg)) {
    return result('tab-closed', 'That tab was closed before the scan finished.');
  }
  return result('inject-failed', `Couldn't read this page: ${msg}`);
}
