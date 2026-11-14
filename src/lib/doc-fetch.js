// Fetches one policy document as text, trying the cheapest way first:
//   1. the service worker (fast, uses the browser's cookies),
//   2. a fetch inside the open tab (page's network context; beats some bot checks),
//   3. a short-lived background tab that renders the page (policies built by
//      JavaScript, like Instagram's, or behind JS bot challenges like DataDome).
// Each step returns { text, reason }: text is null when it failed, and reason
// says why (shown in the coverage harness, never to users as-is).
import { htmlToText } from './html-to-text.js';
import { pdfToText } from './pdf-to-text.js';
import { isBotWall, isLoginRedirect, linksFromHtml, looksLikePolicyText } from './legal-links.js';

export const MIN_DOC_CHARS = 800;
export const MAX_DOC_CHARS = 400000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const RENDER_LOAD_MS = 15000;
const RENDER_SETTLE_MS = 6000;
const RENDER_POLL_MS = 600;
// pagescan.js stays quiet in tabs opened with this marker.
export const RENDER_MARKER = '#caveatly-render';

// Shorter documents may be a hub ("Privacy at Airbnb: read our Privacy Policy")
// whose links the caller can follow, so their links are returned too.
export const HUB_MAX_CHARS = 6000;

const renderTabs = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = reason => ({ text: null, reason });

/** True while tabId is one of our background render tabs (never scan those). */
export function isRenderTab(tabId) {
  return renderTabs.has(tabId);
}

function checkText(text, requestedUrl, finalUrl) {
  if (isLoginRedirect(requestedUrl, finalUrl)) return fail('redirected to sign-in');
  if (text && isBotWall(text)) return fail('bot wall');
  if (!text || text.length < MIN_DOC_CHARS) return fail(`too short (${text ? text.length : 0} chars)`);
  return { text: text.slice(0, MAX_DOC_CHARS), reason: '', finalUrl };
}

// Adds the page's non-footer links to short or failed results (see HUB_MAX_CHARS).
function withHubLinks(result, links) {
  if (result.text && result.text.length >= HUB_MAX_CHARS) return result;
  return { ...result, links: links().filter(l => !l.inFooter) };
}

const isPdfUrl = url => /\.pdf(?:[?#]|$)/i.test(url);

export async function fetchDocText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // credentials:include — sites like Amazon bot-block cookie-less SW fetches (503).
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', credentials: 'include' });
    if (!res.ok) return fail(`http ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (/pdf/i.test(type) || isPdfUrl(url)) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_PDF_BYTES) return fail('pdf too large');
      return checkText(await pdfToText(buf), url, res.url);
    }
    if (type && !/html|text|xml/i.test(type)) return fail(`not a document (${type.split(';')[0]})`);
    const html = await res.text();
    return withHubLinks(checkText(htmlToText(html), url, res.url), () => linksFromHtml(html, res.url || url));
  } catch (e) {
    return fail(e.name === 'AbortError' ? 'timeout' : `network: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// When the service worker is bot-blocked, fetch from the open tab so the request
// uses the page's cookie jar + network context (fixes Amazon help pages).
export async function fetchDocTextViaTab(tabId, url) {
  if (tabId == null) return fail('no tab');
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [url, FETCH_TIMEOUT_MS],
      func: async (docUrl, timeoutMs) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(docUrl, { signal: controller.signal, redirect: 'follow', credentials: 'include' });
          if (!res.ok) return { error: `http ${res.status}` };
          const type = res.headers.get('content-type') || '';
          if (/pdf/i.test(type) || /\.pdf(\?|#|$)/i.test(docUrl)) return { error: 'pdf' };
          if (type && !/html|text|xml/i.test(type)) return { error: 'not a document' };
          return { html: await res.text(), finalUrl: res.url };
        } catch (e) {
          return { error: `network: ${e.message}` };
        } finally {
          clearTimeout(timer);
        }
      },
    });
    if (!result || typeof result.html !== 'string') return fail(`in-tab ${result?.error || 'no result'}`);
    const checked = checkText(htmlToText(result.html), url, result.finalUrl);
    return withHubLinks(checked.text ? checked : fail(`in-tab ${checked.reason}`), () => linksFromHtml(result.html, result.finalUrl || url));
  } catch (e) {
    return fail(`in-tab: ${e.message}`);
  }
}

function waitForComplete(tabId, timeoutMs) {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') done(); }).catch(done);
  });
}

async function readRenderedText(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const main = document.querySelector('main, article, [role="main"]');
        const mainText = main ? main.innerText || '' : '';
        const text = mainText.length >= 2000 ? mainText : (document.body ? document.body.innerText || '' : '');
        const footer = 'footer, [role="contentinfo"], [id*="footer" i], [class*="footer" i]';
        const links = [...document.querySelectorAll('a[href]')].slice(0, 1500)
          .filter(a => /^https?:/i.test(a.href))
          .map(a => ({ text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160), href: a.href, inFooter: Boolean(a.closest(footer)) }));
        return { text, url: location.href, links };
      },
    });
    return result || null;
  } catch {
    return null; // tab still navigating, or an error page: try again next poll
  }
}

// Opens the document in a background tab next to the user's tab, waits for it
// to render, reads its text and closes it. Last resort: costs a few seconds.
export async function fetchDocTextViaRenderedTab(url, sourceTabId) {
  if (isPdfUrl(url)) return fail('render: pdf');
  const source = await chrome.tabs.get(sourceTabId).catch(() => null);
  let tab;
  try {
    tab = await chrome.tabs.create({
      url: `${url.split('#')[0]}${RENDER_MARKER}`,
      active: false,
      ...(source ? { windowId: source.windowId, index: source.index + 1 } : {}),
    });
  } catch (e) {
    return fail(`render: ${e.message}`);
  }
  renderTabs.add(tab.id);
  try {
    chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    await waitForComplete(tab.id, RENDER_LOAD_MS);
    const deadline = Date.now() + RENDER_SETTLE_MS;
    let last = null;
    for (;;) {
      last = (await readRenderedText(tab.id)) || last;
      const ready = last && last.text.length >= MIN_DOC_CHARS && !isBotWall(last.text) && looksLikePolicyText(last.text);
      if (ready || Date.now() >= deadline) break;
      await sleep(RENDER_POLL_MS);
    }
    if (!last) return fail('render: could not read tab');
    const checked = checkText(last.text.replace(/\n{3,}/g, '\n\n').trim(), url, last.url);
    return withHubLinks(checked.text ? checked : fail(`render ${checked.reason}`), () => last.links || []);
  } finally {
    renderTabs.delete(tab.id);
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Service worker, then in-tab fetch, then (if allowed) a rendered background tab. */
export async function fetchDocTextBest(url, tabId, { render = true } = {}) {
  const direct = await fetchDocText(url);
  if (direct.text) return direct;
  const inTab = await fetchDocTextViaTab(tabId, url);
  if (inTab.text) return inTab;
  const links = [...(direct.links || []), ...(inTab.links || [])];
  if (!render || tabId == null) return { ...fail(`${direct.reason}; ${inTab.reason}`), links };
  const rendered = await fetchDocTextViaRenderedTab(url, tabId);
  if (rendered.text) return rendered;
  return { ...fail(`${direct.reason}; ${inTab.reason}; ${rendered.reason}`), links: [...links, ...(rendered.links || [])] };
}
