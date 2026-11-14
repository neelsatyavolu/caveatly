import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../components/IconButton.jsx';
import { Section, SettingToggle } from './settings/Section.jsx';
import { ApiKeyField } from './settings/ApiKeyField.jsx';
import { ScanModePicker } from './settings/ScanModePicker.jsx';
import { PausedSites, HiddenElements } from './settings/SiteLists.jsx';
import { BLOCKER_ALLOWED, TELEMETRY_ALLOWED, featureAllowed } from '../lib/embed.js';

// Chrome applies privacy prefs asynchronously after a toggle is saved.
const PRIVACY_STATUS_DELAY_MS = 300;
const CHROME_PRIVACY_KEYS = ['disableAdApis', 'blockThirdPartyCookies', 'protectWebRtc', 'blockPings', 'hardenChromeServices'];

function usePrivacyStatus(settings) {
  const [status, setStatus] = React.useState({});
  const deps = CHROME_PRIVACY_KEYS.map(k => settings[k]);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'browserPrivacy:status' })
        .then(resp => { if (resp?.ok) setStatus(resp.status); })
        .catch(() => {});
    }, PRIVACY_STATUS_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return status;
}

/** Settings view. `focus` scrolls to a section on open (e.g. 'fine-print' from the API-key prompt). */
export function SettingsPanel({ settings, onSettingChange, apiKeys, onSaveApiKey, onBack, focus }) {
  const privacy = usePrivacyStatus(settings);
  const toggle = (name, label, description) => (
    <SettingToggle settings={settings} onSettingChange={onSettingChange} name={name} label={label} description={description} status={privacy[name]} />
  );

  React.useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ block: 'start' });
  }, [focus]);

  return (
    <div style={{ width: '100%', background: 'var(--surface-page)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
        <IconButton label="Back" onClick={onBack}><ArrowLeft size={18} /></IconButton>
        <h1 style={{ margin: 0, fontWeight: 700, fontSize: 15, color: 'var(--text-strong)' }}>Settings</h1>
      </div>

      {BLOCKER_ALLOWED && (<>
      <Section title="Ad blocking" id="ad-blocking">
        {toggle('adblockOn', 'Ad blocker', 'Blocks ads, trackers and cookie notices. Turning it off keeps your choices for each list.')}
        {settings.adblockOn && (<>
        {toggle('blockAds', 'Block ads', 'On every site, including YouTube video ads and sponsored search results.')}
        {toggle('blockTrackers', 'Block trackers', 'Stops analytics and tracking requests.')}
        {toggle('blockCookieNotices', 'Hide cookie notices', 'Hides cookie banners the cookie guard can’t answer.')}
        {toggle('blockAnnoyances', 'Hide annoyances', 'Newsletter pop-ups, social share bars and chat bubbles. Can sometimes hide something you wanted.')}
        </>)}
        <PausedSites sites={settings.pausedSites} onResume={site => onSettingChange('pausedSites', settings.pausedSites.filter(s => s !== site))} />
        <HiddenElements />
      </Section>

      <Section title="Privacy" id="privacy">
        {toggle('disableAdApis', 'Turn off Chrome’s ad features', 'Stops Topics, Protected Audience and ad measurement from profiling you.')}
        {toggle('unwrapLinks', 'Skip tracking redirects', 'Links through google.com/url, Facebook, Reddit and similar go straight to the real site.')}
        {toggle('minimize', 'Remove tracking from links', 'Strips tags like utm_source, gclid and fbclid. Sign-in and checkout pages are left alone.')}
        {toggle('protectWebRtc', 'Hide your IP from WebRTC', 'Video-call features can’t reveal your local network address.')}
        {toggle('blockPings', 'Block link-click pings', 'Sites can’t report which links you click.')}
        {featureAllowed('gpc') && toggle('gpc', 'Send Global Privacy Control', 'Tells sites not to sell or share your data.')}
        {toggle('blockThirdPartyCookies', 'Block third-party cookies', 'Stops other sites’ cookies on the pages you visit. Some sign-ins may break.')}
        {toggle('hardenChromeServices', 'Limit what Chrome sends to Google', 'Mistyped addresses, spell-check text and page preloading. Pages may open a little slower.')}
      </Section>

      {featureAllowed('cookieGuard') && (
      <Section title="Cookie guard" id="cookies">
        {toggle('block', 'Accept necessary cookies only', 'Picks “necessary only” on cookie banners when it’s offered.')}
        {toggle('autoReject', 'Reject optional cookies', 'Clicks “reject all” and closes the banner for you.')}
      </Section>
      )}
      </>)}

      <Section title="Fine print" id="fine-print">
        <ApiKeyField apiKeys={apiKeys} onSaveApiKey={onSaveApiKey} />
        <ScanModePicker value={settings.pageScan} onChange={mode => onSettingChange('pageScan', mode)} />
      </Section>

      {TELEMETRY_ALLOWED && (
        <Section title="Usage stats" id="usage">
          {toggle('usageStats', 'Share anonymous usage stats', 'A daily ping with a random install ID, extension version and Chrome version. No personal data.')}
        </Section>
      )}
      <div style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Caveatly v{chrome.runtime.getManifest().version} · settings sync with Chrome</div>
    </div>
  );
}
