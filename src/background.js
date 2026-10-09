// Caveatly MV3 service worker: orchestrates page scans, caches reports per
// origin, keeps the toolbar badge in sync, and applies privacy network rules.
import { extractLegalSources } from './lib/extract-page.js';
import { htmlToText } from './lib/html-to-text.js';
import { pdfToText } from './lib/pdf-to-text.js';
import { analyzeLegalDocs, GroqError } from './lib/groq.js';
import { buildReport, pageDocLabel } from './lib/report.js';
import { getSettings, getApiConfig, DEFAULT_SETTINGS } from './lib/settings.js';
import { maybeSendHeartbeat, syncUninstallUrl } from './lib/heartbeat.js';
import { fetchCredentials, relatedOrigins } from './lib/hosts.js';

const MIN_DOC_CHARS = 800;
const FETCH_TIMEOUT_MS = 15000;

// ————— Scan pipeline —————

function isUsableDocText(text) {
  if (!text || text.length < MIN_DOC_CHARS) return false;
  // Soft bot walls (Amazon often returns 200/503 with this shell instead of the policy).
  if (/api-services-support@amazon\.com|automated access to Amazon data/i.test(text)) return false;
  return true;
}

async function fetchDocText(url, pageOrigin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Cookies only for the site being scanned. Same-site fetches still send
    // cookies (Amazon bot-blocks a cookie-less service-worker fetch); a legal
    // link pointing at some other host must not carry that host's cookies.
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      credentials: fetchCredentials(pageOrigin, url),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (/pdf/i.test(type) || /\.pdf(\?|#|$)/i.test(url)) {
      const text = await pdfToText(await res.arrayBuffer());
      return isUsableDocText(text) ? text : null;
    }
    // Content-Type is case-insensitive; the tab fallback already treated it that way.
    if (type && !/html|text|xml/i.test(type)) return null;
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
async function fetchDocTextViaTab(tabId, url, pageOrigin) {
  if (tabId == null) return null;
  try {
    const credentials = fetchCredentials(pageOrigin, url);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [url, FETCH_TIMEOUT_MS, credentials],
      func: async (docUrl, timeoutMs, credentialsMode) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(docUrl, { signal: controller.signal, redirect: 'follow', credentials: credentialsMode });
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

async function fetchDocTextBest(url, tabId, pageOrigin) {
  return (await fetchDocText(url, pageOrigin)) || (await fetchDocTextViaTab(tabId, url, pageOrigin));
}

function docLabel(kind, linkText) {
  if (kind === 'privacy') return 'Privacy Policy';
  if (kind === 'terms') return 'Terms of Service';
  return linkText || 'Legal';
}

function decodeAttr(value) {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

// Deep pages sometimes lack footer links — fall back to scanning homepage HTML
// (this origin, then related apex/www origins) for Terms/Privacy links.
// Keeps a few alternates per kind so a short or blocked first link isn't the end.
async function homepageCandidates(origin, excludeUrl, pageOrigin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/`, {
      credentials: fetchCredentials(pageOrigin || origin, `${origin}/`),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const LEGAL = /(terms|conditions|privacy|polic(?:y|ies)|legal|eula|agreement)/i;
    const lists = { terms: [], privacy: [], legal: [] };
    const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,150}?)<\/a>/gi;
    let m;
    while ((m = anchor.exec(html))) {
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      const href = decodeAttr(m[1]);
      if (!LEGAL.test(text) && !LEGAL.test(href)) continue;
      let abs;
      try { abs = new URL(href, origin).href.split('#')[0]; } catch { continue; }
      if (!/^https?:/.test(abs) || abs === excludeUrl) continue;
      const hay = text + ' ' + abs;
      const kind = /privacy|data.?protection/i.test(hay) ? 'privacy'
        : /terms|conditions|eula|agreement/i.test(hay) ? 'terms' : 'legal';
      if (lists[kind].length < 4) lists[kind].push({ url: abs, text, kind });
    }
    // Prefer real terms/privacy over generic "legal" (FOIA, Law Department, …).
    const picked = [];
    if (lists.terms[0]) picked.push(lists.terms[0]);
    if (lists.privacy[0]) picked.push(lists.privacy[0]);
    for (const c of [...lists.terms.slice(1), ...lists.privacy.slice(1), ...lists.legal]) {
      if (picked.length >= 6) break;
      picked.push(c);
    }
    return picked;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fallbackCandidates(origin, excludeUrl) {
  for (const o of relatedOrigins(origin)) {
    const cands = await homepageCandidates(o, excludeUrl, origin);
    if (cands.some(c => c.kind === 'terms' || c.kind === 'privacy')) return cands;
  }
  return [];
}

// Try candidates in order until two usable docs are in hand. The first pair is
// fetched together; later links are only used when an earlier one is unusable.
async function fetchCandidateDocs(candidates, docs, tabId, pageOrigin) {
  const seen = new Set(docs.map(d => d.url));
  const queue = [];
  for (const c of candidates) {
    if (!c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    queue.push(c);
  }
  let index = 0;
  while (docs.length < 2 && index < queue.length) {
    const batch = queue.slice(index, index + Math.min(2, 2 - docs.length));
    index += batch.length;
    const fetched = await Promise.all(batch.map(async c => ({
      c,
      text: await fetchDocTextBest(c.url, tabId, pageOrigin),
    })));
    for (const { c, text } of fetched) {
      if (text && docs.length < 2) docs.push({ label: docLabel(c.kind, c.text), url: c.url, text });
    }
  }
}

async function gatherDocs(extracted, tabId) {
  const docs = [];
  if (extracted.looksLegal && extracted.pageText && isUsableDocText(extracted.pageText)) {
    docs.push({ label: pageDocLabel(extracted.title, extracted.url), url: extracted.url, text: extracted.pageText });
  }
  const pageUrl = extracted.url.split('#')[0];
  const candidates = (extracted.candidates || [])
    .filter(c => c.url.split('#')[0] !== pageUrl);
  await fetchCandidateDocs(candidates, docs, tabId, extracted.origin);
  if (!docs.length) {
    await fetchCandidateDocs(await fallbackCandidates(extracted.origin, pageUrl), docs, tabId, extracted.origin);
  }
  return docs;
}

async function runScan(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) {
    return { ok: false, error: 'unsupported-page', message: 'Caveatly can only scan regular web pages.' };
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

// The badge used to stick on the tab after navigation, and a cached report
// never showed a badge until that tab was scanned again.
async function syncBadgeForTab(tabId, url) {
  try {
    if (tabId == null) return;
    if (!url || !/^https?:/i.test(url)) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const key = `report:${new URL(url).origin}`;
    const session = await chrome.storage.session.get(key);
    let report = session[key];
    if (!report) {
      const local = await chrome.storage.local.get(key);
      report = local[key] || null;
    }
    if (!report?.stats) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    updateBadge(tabId, report);
  } catch {
    // Tab closed or URL unreadable.
  }
}

async function syncAllBadges() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(tab => syncBadgeForTab(tab.id, tab.url)));
  } catch {
    // best effort
  }
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
  startUsageStats();
  syncAllBadges();
});

// No alarms permission: the daily heartbeat piggybacks on service-worker
// wake-ups (install, browser start, any message) and sends once per UTC day.
async function startUsageStats() {
  const { usageStats } = await getSettings();
  await syncUninstallUrl(usageStats);
  maybeSendHeartbeat();
}

chrome.runtime.onStartup.addListener(() => {
  startUsageStats();
  syncAllBadges();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.gpc || changes.minimize)) applyNetworkRules();
  if (area === 'sync' && changes.usageStats) {
    syncUninstallUrl(changes.usageStats.newValue);
    if (changes.usageStats.newValue) maybeSendHeartbeat();
  }
});

chrome.tabs.onRemoved.addListener(tabId => consentByTab.delete(tabId));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') syncBadgeForTab(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  maybeSendHeartbeat();
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
