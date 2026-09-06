import React from 'react';
import { createRoot } from 'react-dom/client';
import { PopupHome } from './screens/PopupHome.jsx';
import { ReportPanel } from './screens/ReportPanel.jsx';
import { SettingsPanel } from './screens/SettingsPanel.jsx';
import { getSettings, saveSettings, getApiConfig, saveApiKey, DEFAULT_SETTINGS } from './lib/settings.js';

// The popup normally targets the active tab. After an on-page scan the service
// worker sets focusTabId so we still bind to the scanned site when Chrome opens
// us as a detached window. Fallback: most recently used http(s) tab (e2e / dev).
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

function App() {
  const [view, setView] = React.useState('home'); // home | report | settings
  const [status, setStatus] = React.useState('loading'); // loading | scanning | ready | idle | needs-key | error | no-tab
  const [settings, setSettings] = React.useState(DEFAULT_SETTINGS);
  const [apiKeys, setApiKeys] = React.useState({});
  const [tab, setTab] = React.useState(null);
  const [report, setReport] = React.useState(null);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [consentAction, setConsentAction] = React.useState(null);

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
        getSettings(), getApiConfig(), findTargetTab(),
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

  React.useEffect(() => {
    document.documentElement.dataset.view = view === 'report' ? 'report' : '';
  }, [view]);

  // Detached fallback window (openPopup often fails after an on-page scan)
  // can restore a previous huge size. Snap it back to the report shell.
  React.useEffect(() => {
    if (!chrome.windows?.getCurrent) return;
    const width = view === 'report' ? 460 : 400;
    chrome.windows.getCurrent()
      .then(win => {
        if (!win || win.type !== 'popup') return;
        const tooWide = (win.width || 0) > width + 24;
        const tooTall = (win.height || 0) > 720;
        if (!tooWide && !tooTall && Math.abs((win.width || 0) - width) < 24) return;
        return chrome.windows.update(win.id, { width, height: 640 });
      })
      .catch(() => {});
  }, [view]);

  if (view === 'report' && report) return <ReportPanel report={report} siteUrl={tab?.url} onBack={() => setView('home')} />;
  if (view === 'settings') {
    return <SettingsPanel settings={settings} onSettingChange={onSettingChange} apiKeys={apiKeys} onSaveApiKey={onSaveApiKey} onBack={() => setView('home')} />;
  }
  return (
    <PopupHome
      report={status === 'ready' ? report : null}
      status={status === 'loading' ? 'scanning' : status}
      errorMessage={errorMessage}
      site={site}
      siteUrl={tab?.url}
      cookieFooter={cookieFooterFor(settings, consentAction)}
      onScan={() => scan()}
      onOpenReport={() => setView('report')}
      onOpenSettings={() => setView('settings')}
    />
  );
}

createRoot(document.getElementById('root')).render(<App />);
