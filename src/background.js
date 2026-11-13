// Caveatly MV3 service worker: orchestrates page scans, caches reports per
// origin, keeps the toolbar badge in sync, and applies privacy and ad-blocking rules.
import { extractLegalSources } from './lib/extract-page.js';
import { gatherDocs, fitDocs, pdfTabExtract } from './lib/doc-sources.js';
import { isRenderTab, MAX_DOC_CHARS } from './lib/doc-fetch.js';
import { unsupportedTab, injectionFailure, isPdfUrl } from './lib/scan-target.js';
import { LINK_PREFILTER_SOURCE, HREF_PREFILTER_SOURCE, PRIVACY_TEXT_SOURCE, TERMS_TEXT_SOURCE } from './lib/legal-links.js';
import { analyzeLegalDocs, GroqError } from './lib/groq.js';
import { buildReport } from './lib/report.js';
import { getSettings, getApiConfig, DEFAULT_SETTINGS } from './lib/settings.js';
import { maybeSendHeartbeat, syncUninstallUrl } from './lib/heartbeat.js';
import { applyAdblockSettings, cosmeticsFor, adblockStatus, setSitePaused, initAdblockLists } from './lib/adblock.js';
import { initBrowserPrivacy } from './lib/browser-privacy.js';
import { initLinkCleaning } from './lib/link-cleaning.js';
import { initCustomRules } from './lib/custom-rules.js';

// ————— Scan pipeline —————
// Finding and fetching documents lives in lib/doc-sources.js and lib/doc-fetch.js;
// lib/scan-target.js explains pages that cannot be scanned.

const EXTRACT_OPTS = {
  linkSource: LINK_PREFILTER_SOURCE,
  hrefSource: HREF_PREFILTER_SOURCE,
  privacySource: PRIVACY_TEXT_SOURCE,
  termsSource: TERMS_TEXT_SOURCE,
  // Late footers on single-page apps: wait up to this long for terms + privacy links.
  waitMs: 5000,
  maxPageChars: MAX_DOC_CHARS,
};

// What the scan found and read, for the popup ("Read: Privacy Policy, 42k
// characters") and the coverage harness. Never includes document text.
function scanSources(candidates, docs, failures) {
  return {
    candidates: candidates.map(c => ({ url: c.url, kind: c.kind })),
    docs: docs.map(d => ({ kind: d.kind, label: d.label, url: d.url, chars: d.text.length })),
    failures,
  };
}

const EXTRACT_ATTEMPTS = 3;
const EXTRACT_RETRY_MS = 1500;

async function extractFromTab(tab) {
  if (isPdfUrl(tab.url)) return pdfTabExtract(tab.url);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractLegalSources,
        args: [EXTRACT_OPTS],
      });
      // Chrome's PDF viewer on a URL without .pdf in it.
      if (result && /pdf/i.test(result.contentType)) return pdfTabExtract(tab.url);
      if (result) return { extracted: result };
    } catch (e) {
      const navigating = /destroyed|removed|navigat|No frame|back\/forward cache/i.test(e.message);
      if (!navigating || attempt >= EXTRACT_ATTEMPTS) return { failure: injectionFailure(e, tab) };
    }
    // No result means the page navigated while we read it (Booking.com reloads
    // itself after load): give it a moment and read the new page.
    if (attempt >= EXTRACT_ATTEMPTS) {
      return { failure: { ok: false, error: 'inject-failed', message: 'This page kept reloading while Caveatly read it. Wait for it to settle, then scan again.' } };
    }
    await new Promise(r => setTimeout(r, EXTRACT_RETRY_MS));
  }
}

async function runScan(tabId) {
  if (isRenderTab(tabId)) return { ok: false, error: 'render-tab', message: 'Caveatly opened this tab to read a policy; it closes by itself.' };
  const tab = await chrome.tabs.get(tabId);
  const unsupported = await unsupportedTab(tab);
  if (unsupported) return unsupported;

  const { apiKey, apiBase, model, maxInputChars, maxOutputTokens } = await getApiConfig();
  if (!apiKey) return { ok: false, error: 'no-key' };

  const { extracted, failure } = await extractFromTab(tab);
  if (failure) return failure;

  const { docs: found, candidates, failures } = await gatherDocs(extracted, tabId);
  const sources = scanSources(candidates, found, failures);
  if (!found.length) {
    const message = extracted.isPdf
      ? "This PDF doesn't look like terms of service or a privacy policy, so there is nothing to scan."
      : `Couldn't find terms of service or a privacy policy for ${extracted.hostname}. The site may not link them, or it blocked Caveatly from reading them.`;
    return { ok: false, error: 'no-docs', message, sources };
  }
  const docs = fitDocs(found, maxInputChars);

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
    return { ok: true, report, sources };
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

// After an on-page scan, open the toolbar popup so the user doesn't have to hunt
// for the icon. openPopup often rejects (window not focused, no user gesture);
// then the on-page toast shows the grade instead. Never open a separate window.
async function openReportUi(tabId) {
  if (typeof chrome.action.openPopup !== 'function') return false;
  await chrome.storage.session.set({ focusTabId: tabId });
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.action.openPopup({ windowId: tab.windowId });
    return true;
  } catch {
    await chrome.storage.session.remove('focusTabId');
    return false;
  }
}

// ————— Consent-handler results (per tab, session-scoped) —————

const consentByTab = new Map();

// ————— Privacy network rules (GPC header; tracking params live in lib/link-cleaning.js) —————

const GPC_RULE_ID = 1001;
// Above the per-site pause rule (lib/adblock.js), so pausing ad blocking on a
// site keeps GPC working there.
const PRIVACY_RULE_PRIORITY = 200000;

async function applyNetworkRules() {
  const settings = await getSettings();
  const addRules = [];
  if (settings.gpc) {
    addRules.push({
      id: GPC_RULE_ID,
      priority: PRIVACY_RULE_PRIORITY,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }],
      },
      condition: { urlFilter: '*', resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [GPC_RULE_ID],
    addRules,
  });
}

// ————— Wiring —————

initBrowserPrivacy();
initLinkCleaning();
initCustomRules();
initAdblockLists();

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (stored[k] === undefined) missing[k] = v;
  }
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
  applyNetworkRules();
  applyAdblockSettings();
  startUsageStats();
});

// No alarms permission: the daily heartbeat piggybacks on service-worker
// wake-ups (install, browser start, any message) and sends once per UTC day.
async function startUsageStats() {
  const { usageStats } = await getSettings();
  await syncUninstallUrl(usageStats);
  maybeSendHeartbeat();
}

chrome.runtime.onStartup.addListener(startUsageStats);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.gpc) applyNetworkRules();
  if (area === 'sync' && (changes.blockAds || changes.blockTrackers || changes.pausedSites)) applyAdblockSettings();
  if (area === 'sync' && changes.usageStats) {
    syncUninstallUrl(changes.usageStats.newValue);
    if (changes.usageStats.newValue) maybeSendHeartbeat();
  }
});

chrome.tabs.onRemoved.addListener(tabId => consentByTab.delete(tabId));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Element-hiding requests come from every frame of every page; answer them
  // before anything else and keep them out of the heartbeat path.
  if (msg?.type === 'cosmetics') {
    cosmeticsFor(msg, sender).then(sendResponse).catch(() => sendResponse({ active: false, scripts: [], styles: '', extended: [] }));
    return true;
  }
  maybeSendHeartbeat();
  // Popup-only controls: ignore them when they come from a content script.
  const fromPopup = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('popup.html'));
  if (msg?.type === 'adblockStatus' && fromPopup) {
    adblockStatus(msg.tabId, msg.url).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (msg?.type === 'setSitePaused' && fromPopup) {
    setSitePaused(msg.hostname, msg.paused).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, message: e.message }));
    return true;
  }
  if (msg?.type === 'scan') {
    runScan(msg.tabId).then(sendResponse).catch(e => sendResponse({ ok: false, error: 'unexpected', message: e.message }));
    return true; // async response
  }
  if (msg?.type === 'scanFromPage' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    runScan(tabId)
      .then(async result => {
        const opened = result?.ok ? await openReportUi(tabId).catch(() => false) : false;
        sendResponse({ ...result, opened });
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
