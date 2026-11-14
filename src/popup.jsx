import React from 'react';
import { createRoot } from 'react-dom/client';
import { PopupHome } from './screens/PopupHome.jsx';
import { ReportPanel } from './screens/ReportPanel.jsx';
import { SettingsPanel } from './screens/SettingsPanel.jsx';
import { BLOCKER_ALLOWED, featureAllowed } from './lib/embed.js';
import { getStoredSettings, saveSettings, getApiConfig, saveApiKey, DEFAULT_SETTINGS } from './lib/settings.js';

// The popup normally targets the active tab. After an on-page scan the service
// worker sets focusTabId so we bind to the scanned site even if focus moved.
// Fallback: most recently used http(s) tab (e2e / dev).
async function findTargetTab() {
  const { focusTabId } = await chrome.storage.session.get('focusTabId');
  if (focusTabId != null) {
    await chrome.storage.session.remove('focusTabId');
    const focused = await chrome.tabs.get(focusTabId).catch(() => null);
    if (focused?.url && /^https?:/.test(focused.url)) return focused;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && /^https?:/.test(active.url)) return active;
  const all = await chrome.tabs.query({});
  const webTabs = all.filter(t => t.url && /^https?:/.test(t.url));
  webTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return webTabs[0] || null;
}

function cookieFooterFor(settings, consentAction) {
  if (consentAction === 'necessary-only') return { on: true, text: 'Accepted necessary cookies only' };
  if (consentAction === 'rejected') return { on: true, text: 'Rejected optional cookies on this site' };
  if (settings.block || settings.autoReject) return { on: true, text: 'Cookie guard is on' };
  return { on: false, text: 'Cookie guard is off' };
}

const ADBLOCK_REFRESH_MS = 2000;

function App() {
  const [view, setView] = React.useState('home'); // home | report | settings
  const [settingsFocus, setSettingsFocus] = React.useState(null);
  const [notice, setNotice] = React.useState('');
  const [status, setStatus] = React.useState('loading'); // loading | scanning | ready | idle | needs-key | error | no-tab
  const [settings, setSettings] = React.useState(DEFAULT_SETTINGS);
  const [apiKeys, setApiKeys] = React.useState({});
  const [tab, setTab] = React.useState(null);
  const [report, setReport] = React.useState(null);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [consentAction, setConsentAction] = React.useState(null);
  const [adblock, setAdblock] = React.useState(null); // { enabled, paused, blocked } | null

  const scan = React.useCallback(async targetTab => {
    const t = targetTab || tab;
    if (!t) return;
    setStatus('scanning');
    setErrorMessage('');
    const resp = await chrome.runtime.sendMessage({ type: 'scan', tabId: t.id }).catch(e => ({ ok: false, error: 'unexpected', message: e.message }));
    if (resp?.ok) {
      setReport(resp.report);
      setStatus('ready');
    } else if (resp?.error === 'no-key') {
      setStatus('needs-key');
    } else {
      setErrorMessage(resp?.message || 'Something went wrong.');
      setStatus('error');
    }
  }, [tab]);

  React.useEffect(() => {
    (async () => {
      const [loadedSettings, apiConfig, targetTab] = await Promise.all([
        getStoredSettings(), getApiConfig(), findTargetTab(),
      ]);
      const key = apiConfig.apiKey;
      setSettings(loadedSettings);
      setApiKeys(apiConfig.apiKeys);
      setTab(targetTab);
      if (!targetTab) { setStatus('no-tab'); return; }

      chrome.runtime.sendMessage({ type: 'getConsent', tabId: targetTab.id })
        .then(r => setConsentAction(r?.action || null)).catch(() => {});

      const origin = new URL(targetTab.url).origin;
      const { report: cached } = await chrome.runtime.sendMessage({ type: 'getCached', origin }).catch(() => ({ report: null }));
      if (cached) { setReport(cached); setStatus('ready'); return; }
      if (!key) { setStatus('needs-key'); return; }
      // Never auto-scan from the toolbar — user starts scans manually (or via on-page auto).
      setStatus('idle');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    saveSettings({ [key]: value });
  };

  const onSaveApiKey = async (forProvider, value) => {
    await saveApiKey(forProvider, value);
    setApiKeys(prev => ({ ...prev, gemini: value }));
    if (status === 'needs-key') setStatus('idle');
  };

  const site = tab ? new URL(tab.url).hostname.replace(/^www\./, '') : null;

  // Blocked-request count for the open tab, refreshed while the popup is open.
  React.useEffect(() => {
    if (!tab) return undefined;
    let cancelled = false;
    const refresh = () => chrome.runtime.sendMessage({ type: 'adblockStatus', tabId: tab.id, url: tab.url })
      .then(next => { if (!cancelled && next) setAdblock(next); })
      .catch(() => {});
    refresh();
    const timer = setInterval(refresh, ADBLOCK_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [tab, settings.adblockOn, settings.blockAds, settings.blockTrackers, settings.pausedSites]);

  // Turning the ad blocker on from the footer. If every list was switched off
  // one by one, bring back ads and trackers so the switch actually blocks.
  const onTurnOnAdblock = async () => {
    const listsOff = !settings.blockAds && !settings.blockTrackers && !settings.blockCookieNotices && !settings.blockAnnoyances;
    const patch = listsOff ? { adblockOn: true, blockAds: true, blockTrackers: true } : { adblockOn: true };
    setSettings(prev => ({ ...prev, ...patch }));
    await saveSettings(patch);
    setAdblock(prev => ({ ...prev, enabled: true, paused: false, blocked: null }));
    if (tab) chrome.tabs.reload(tab.id).catch(() => {});
  };

  // Pausing takes effect on the next page load, so reload the tab right away.
  const onTogglePause = async () => {
    if (!tab || !adblock) return;
    const paused = !adblock.paused;
    const resp = await chrome.runtime.sendMessage({ type: 'setSitePaused', hostname: new URL(tab.url).hostname, paused })
      .catch(() => null);
    if (!resp?.ok) return;
    setAdblock(prev => ({ ...prev, paused, blocked: null }));
    const site = new URL(tab.url).hostname.replace(/^www\./, '');
    setSettings(prev => ({
      ...prev,
      pausedSites: paused ? [...prev.pausedSites.filter(s => s !== site), site] : prev.pausedSites.filter(s => s !== site),
    }));
    chrome.tabs.reload(tab.id).catch(() => {});
  };

  // Right-click → Block element, started from the popup. The popup closes so
  // the page has focus for the picker's keyboard controls.
  const onPickElement = async () => {
    const resp = await chrome.runtime.sendMessage({ type: 'customRules:startPicker', tabId: tab.id }).catch(() => null);
    if (resp?.ok) window.close();
    else setNotice(resp?.message || 'Chrome doesn’t let extensions change this page.');
  };

  React.useEffect(() => {
    document.documentElement.dataset.view = view === 'report' ? 'report' : '';
  }, [view]);

  if (view === 'report' && report) return <ReportPanel report={report} siteUrl={tab?.url} onBack={() => setView('home')} />;
  if (view === 'settings') {
    return <SettingsPanel settings={settings} onSettingChange={onSettingChange} apiKeys={apiKeys} onSaveApiKey={onSaveApiKey} onBack={() => setView('home')} focus={settingsFocus} />;
  }
  return (
    <PopupHome
      report={status === 'ready' ? report : null}
      status={status === 'loading' ? 'scanning' : status}
      errorMessage={errorMessage}
      site={site}
      siteUrl={tab?.url}
      cookieFooter={featureAllowed('cookieGuard') ? cookieFooterFor(settings, consentAction) : null}
      adblock={BLOCKER_ALLOWED ? adblock : null}
      showProtection={BLOCKER_ALLOWED}
      onTogglePause={onTogglePause}
      onTurnOnAdblock={onTurnOnAdblock}
      onScan={() => scan()}
      onOpenReport={() => setView('report')}
      onOpenSettings={() => { setSettingsFocus(null); setView('settings'); }}
      onOpenKeySettings={() => { setSettingsFocus('fine-print'); setView('settings'); }}
      onPickElement={tab && BLOCKER_ALLOWED ? onPickElement : null}
      notice={notice}
    />
  );
}

createRoot(document.getElementById('root')).render(<App />);
