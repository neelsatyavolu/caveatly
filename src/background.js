// Fineprint MV3 service worker: orchestrates page scans, caches reports per
// origin, keeps the toolbar badge in sync, and applies privacy network rules.
import { extractLegalSources } from './lib/extract-page.js';
import { htmlToText } from './lib/html-to-text.js';
import { pdfToText } from './lib/pdf-to-text.js';
import { analyzeLegalDocs, GroqError } from './lib/groq.js';
import { buildReport } from './lib/report.js';
import { getSettings, getApiConfig, DEFAULT_SETTINGS } from './lib/settings.js';

const MIN_DOC_CHARS = 800;
const FETCH_TIMEOUT_MS = 15000;

// ————— Scan pipeline —————

function isUsableDocText(text) {
  if (!text || text.length < MIN_DOC_CHARS) return false;
  // Soft bot walls (Amazon often returns 200/503 with this shell instead of the policy).
  if (/api-services-support@amazon\.com|automated access to Amazon data/i.test(text)) return false;
  return true;
}

async function fetchDocText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // credentials:include — sites like Amazon bot-block cookie-less SW fetches (503).
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', credentials: 'include' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (/pdf/i.test(type) || /\.pdf(\?|#|$)/i.test(url)) {
      return pdfToText(await res.arrayBuffer());
    }
    if (type && !/html|text|xml/.test(type)) return null;
    const text = htmlToText(await res.text());
    return isUsableDocText(text) ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// When the service worker is bot-blocked, fetch from the open tab so the request
// uses the page's cookie jar + network context (fixes Amazon help pages).
async function fetchDocTextViaTab(tabId, url) {
  if (tabId == null) return null;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [url, FETCH_TIMEOUT_MS],
      func: async (docUrl, timeoutMs) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(docUrl, { signal: controller.signal, redirect: 'follow', credentials: 'include' });
          if (!res.ok) return null;
          const type = res.headers.get('content-type') || '';
          if (/pdf/i.test(type) || /\.pdf(\?|#|$)/i.test(docUrl)) return null;
          if (type && !/html|text|xml/i.test(type)) return null;
          return await res.text();
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      },
    });
    if (typeof result !== 'string') return null;
    const text = htmlToText(result);
    return isUsableDocText(text) ? text : null;
  } catch {
    return null;
  }
}

async function fetchDocTextBest(url, tabId) {
  return (await fetchDocText(url)) || (await fetchDocTextViaTab(tabId, url));
}

function docLabel(kind, linkText) {
  if (kind === 'privacy') return 'Privacy Policy';
  if (kind === 'terms') return 'Terms of Service';
  return linkText || 'Legal';
}

// Subdomains (tools.usps.com, store.github.com) often omit footer legal links.
// Walk the origin, then apex / www.apex so we can still find the site's policies.
// Naive eTLD+1 (last two labels) — good enough for .com/.org/.net; multi-part
// public suffixes (co.uk) may over-strip, which only costs an extra failed fetch.
function relatedOrigins(origin) {
  let u;
  try { u = new URL(origin); } catch { return [origin]; }
  const host = u.hostname.replace(/^www\./i, '');
  const parts = host.split('.').filter(Boolean);
  const out = [];
  const add = (h) => {
    const o = `${u.protocol}//${h}`;
    if (!out.includes(o)) out.push(o);
  };
  add(u.hostname);
  if (parts.length >= 2) {
    const apex = parts.slice(-2).join('.');
    add(apex);
    add(`www.${apex}`);
  }
  // Also try peeling one label at a time (a.b.example.com → b.example.com → …)
  for (let i = 1; i < parts.length - 1; i++) {
    add(parts.slice(i).join('.'));
    add(`www.${parts.slice(i).join('.')}`);
  }
  return out;
}

// Deep pages sometimes lack footer links — fall back to scanning homepage HTML
// (this origin, then related apex/www origins) for Terms/Privacy links.
async function homepageCandidates(origin, excludeUrl) {
  try {
    const res = await fetch(`${origin}/`, { credentials: 'include', redirect: 'follow' });
    if (!res.ok) return [];
    const html = await res.text();
    const LEGAL = /(terms|conditions|privacy|polic(?:y|ies)|legal|eula|agreement)/i;
    const byKind = new Map();
    const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,150}?)<\/a>/gi;
    let m;
    while ((m = anchor.exec(html))) {
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!LEGAL.test(text) && !LEGAL.test(m[1])) continue;
      let abs;
      try { abs = new URL(m[1], origin).href.split('#')[0]; } catch { continue; }
      if (!/^https?:/.test(abs) || abs === excludeUrl) continue;
      const hay = text + ' ' + abs;
      const kind = /privacy|data.?protection/i.test(hay) ? 'privacy'
        : /terms|conditions|eula|agreement/i.test(hay) ? 'terms' : 'legal';
      if (!byKind.has(kind)) byKind.set(kind, { url: abs, text, kind });
    }
    // Prefer real terms/privacy over generic "legal" (FOIA, Law Department, …).
    const picked = [];
    for (const kind of ['terms', 'privacy']) {
      if (byKind.has(kind)) picked.push(byKind.get(kind));
    }
    if (picked.length < 2 && byKind.has('legal')) picked.push(byKind.get('legal'));
    return picked.slice(0, 2);
  } catch {
    return [];
  }
}

async function fallbackCandidates(origin, excludeUrl) {
  for (const o of relatedOrigins(origin)) {
    const cands = await homepageCandidates(o, excludeUrl);
    if (cands.some(c => c.kind === 'terms' || c.kind === 'privacy')) return cands;
  }
  return [];
}

async function fetchCandidateDocs(candidates, docs, tabId) {
  const fetched = await Promise.all(candidates.map(async c => ({
    c,
    text: await fetchDocTextBest(c.url, tabId),
  })));
  for (const { c, text } of fetched) {
    if (text) docs.push({ label: docLabel(c.kind, c.text), url: c.url, text });
  }
}

async function gatherDocs(extracted, tabId) {
  const docs = [];
  if (extracted.looksLegal && extracted.pageText && isUsableDocText(extracted.pageText)) {
    const label = /privacy/i.test(extracted.title + extracted.url) ? 'Privacy Policy' : 'Terms of Service';
    docs.push({ label, url: extracted.url, text: extracted.pageText });
  }
  const pageUrl = extracted.url.split('#')[0];
  const candidates = (extracted.candidates || [])
    .filter(c => c.url.split('#')[0] !== pageUrl)
    .slice(0, 2 - docs.length);
  await fetchCandidateDocs(candidates, docs, tabId);
  if (!docs.length) {
    await fetchCandidateDocs(await fallbackCandidates(extracted.origin, pageUrl), docs, tabId);
  }
  return docs;
}

async function runScan(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) {
    return { ok: false, error: 'unsupported-page', message: 'Fineprint can only scan regular web pages.' };
  }

  const { apiKey, apiBase, model, maxInputChars, maxOutputTokens } = await getApiConfig();
  if (!apiKey) return { ok: false, error: 'no-key' };

  let extracted;
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractLegalSources });
    extracted = result;
  } catch (e) {
    return { ok: false, error: 'inject-failed', message: `Couldn't read this page: ${e.message}` };
  }
  if (!extracted) return { ok: false, error: 'inject-failed', message: "Couldn't read this page." };

  const docs = await gatherDocs(extracted, tabId);
  if (!docs.length) {
    return { ok: false, error: 'no-docs', message: 'No terms of service or privacy policy found on this page.' };
  }

  try {
    const flags = await analyzeLegalDocs({ apiKey, apiBase, model, maxInputChars, maxOutputTokens, site: extracted.hostname, docs });
    const report = buildReport({
      site: extracted.hostname,
      title: extracted.title,
      docLabels: docs.map(d => d.label),
      flags,
    });
    // Session for fast tab reloads; local so re-visits don't re-prompt after restart.
    await chrome.storage.session.set({ [`report:${extracted.origin}`]: report });
    await chrome.storage.local.set({ [`report:${extracted.origin}`]: report });
    updateBadge(tabId, report);
    return { ok: true, report };
  } catch (e) {
    if (e instanceof GroqError && (e.code === 'no-key' || e.code === 'bad-key')) {
      return { ok: false, error: 'no-key' };
    }
    return { ok: false, error: 'analyze-failed', message: e.message };
  }
}

function updateBadge(tabId, report) {
  const n = report.stats.concern;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#c23c2d' });
  chrome.action.setBadgeText({ tabId, text: n > 0 ? String(n) : '' });
}

// After an on-page scan, open the report UI so the user doesn't have to hunt for
// the toolbar icon. Prefer the real action popup; fall back to a small window
// (openPopup often rejects after async work or without a user gesture).
async function openReportUi(tabId) {
  await chrome.storage.session.set({ focusTabId: tabId });
  try {
    if (typeof chrome.action.openPopup === 'function') {
      const tab = await chrome.tabs.get(tabId);
      await chrome.action.openPopup({ windowId: tab.windowId });
      return;
    }
  } catch {
    // fall through to detached window
  }
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 400,
    height: 640,
    focused: true,
  });
}

// ————— Consent-handler results (per tab, session-scoped) —————

const consentByTab = new Map();

// ————— Privacy network rules (GPC header + tracking-param stripping) —————

const GPC_RULE_ID = 1001;
const PARAM_RULE_ID = 1002;
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'msclkid', 'mc_eid', 'igshid', 'twclid',
];

async function applyNetworkRules() {
  const settings = await getSettings();
  const addRules = [];
  if (settings.gpc) {
    addRules.push({
      id: GPC_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }],
      },
      condition: { urlFilter: '*', resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
    });
  }
  if (settings.minimize) {
    addRules.push({
      id: PARAM_RULE_ID,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { transform: { queryTransform: { removeParams: TRACKING_PARAMS } } },
      },
      condition: { urlFilter: '*', resourceTypes: ['main_frame'] },
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [GPC_RULE_ID, PARAM_RULE_ID],
    addRules,
  });
}

// ————— Wiring —————

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (stored[k] === undefined) missing[k] = v;
  }
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
  applyNetworkRules();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.gpc || changes.minimize)) applyNetworkRules();
});

chrome.tabs.onRemoved.addListener(tabId => consentByTab.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'scan') {
    runScan(msg.tabId).then(sendResponse).catch(e => sendResponse({ ok: false, error: 'unexpected', message: e.message }));
    return true; // async response
  }
  if (msg?.type === 'scanFromPage' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    runScan(tabId)
      .then(async result => {
        if (result?.ok) await openReportUi(tabId).catch(() => {});
        sendResponse(result);
      })
      .catch(e => sendResponse({ ok: false, error: 'unexpected', message: e.message }));
    return true; // async response
  }
  if (msg?.type === 'getCached') {
    const key = `report:${msg.origin}`;
    chrome.storage.session.get(key).then(async items => {
      let report = items[key] || null;
      if (!report) {
        const local = await chrome.storage.local.get(key);
        report = local[key] || null;
        if (report) await chrome.storage.session.set({ [key]: report });
      }
      sendResponse({ report });
    });
    return true;
  }
  if (msg?.type === 'consentResult' && sender.tab?.id != null) {
    consentByTab.set(sender.tab.id, msg.action);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'getConsent') {
    sendResponse({ action: consentByTab.get(msg.tabId) || null });
    return false;
  }
  return false;
});
