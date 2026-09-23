import React from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { IconButton } from '../components/IconButton.jsx';
import { Toggle } from '../components/Toggle.jsx';
import { Button } from '../components/Button.jsx';
import { PROVIDERS, DEFAULT_PROVIDER } from '../lib/settings.js';

function Section({ title, children }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </div>
  );
}

export function SettingsPanel({ settings, onSettingChange, apiKeys, onSaveApiKey, onBack }) {
  const [draftKey, setDraftKey] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const preset = PROVIDERS[DEFAULT_PROVIDER];
  const hasKey = Boolean(apiKeys.gemini);
  const save = async () => {
    if (!draftKey.trim()) return;
    await onSaveApiKey(DEFAULT_PROVIDER, draftKey.trim());
    setDraftKey('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  return (
    <div style={{ width: '100%', background: 'var(--surface-page)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
        <IconButton label="Back" onClick={onBack}><ArrowLeft size={18} /></IconButton>
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-strong)' }}>Settings</span>
      </div>

      <Section title="AI model">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <KeyRound size={15} style={{ color: hasKey ? 'var(--safe-600)' : 'var(--text-faint)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
              {hasKey ? 'Gemini API key connected' : 'Gemini API key'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={draftKey}
              onChange={e => setDraftKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              placeholder={hasKey ? '•••••••• (replace key)' : preset.keyHint}
              style={{
                flex: 1, height: 'var(--control-md)', padding: '0 12px',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                background: 'var(--surface-card)', color: 'var(--text-strong)',
                fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none', minWidth: 0,
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--focus-ring)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--border-default)'; }}
            />
            <Button size="md" variant="secondary" disabled={!draftKey.trim()} onClick={save}>{saved ? 'Saved' : 'Save'}</Button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.45 }}>
            Reads entire policies (1M context) · free at aistudio.google.com. Key stored only on this device.
          </div>
        </div>
      </Section>

      <Section title="Cookies">
        <Toggle checked={settings.block} onChange={v => onSettingChange('block', v)} label="Block non-essential cookies" description="Auto-accept necessary cookies only on every site." />
        <Toggle checked={settings.autoReject} onChange={v => onSettingChange('autoReject', v)} label="Dismiss consent banners" description="Reject optional tracking and close the popup for you." />
      </Section>
      <Section title="Privacy enhancements">
        <Toggle checked={settings.gpc} onChange={v => onSettingChange('gpc', v)} label="Send Global Privacy Control" description="Tell sites not to sell or share your data." />
        <Toggle checked={settings.minimize} onChange={v => onSettingChange('minimize', v)} label="Strip tracking parameters" description="Clean utm_ and click-id tags from links you open." />
      </Section>
      <Section title="Scanning">
        <div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)', color: 'var(--text-strong)' }}>When Caveatly finds terms or a privacy policy</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 1, marginBottom: 9 }}>
            Only on sites you have not scanned yet. Opening the toolbar never starts a scan by itself.
            {' '}
            {settings.pageScan === 'auto'
              ? 'Auto-scan is on — Caveatly will scan and open the report.'
              : settings.pageScan === 'ask'
                ? 'Ask first — a small toast offers to scan.'
                : 'Off — no on-page prompts or auto-scans.'}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            {[['off', 'Off'], ['ask', 'Ask first'], ['auto', 'Auto-scan']].map(([value, label]) => {
              const active = settings.pageScan === value;
              return (
                <button key={value} onClick={() => onSettingChange('pageScan', value)} style={{
                  cursor: 'pointer', padding: '5px 12px', borderRadius: 999,
                  border: '1px solid ' + (active ? 'var(--teal-600)' : 'var(--border-default)'),
                  background: active ? 'var(--teal-600)' : 'var(--surface-card)',
                  color: active ? '#fff' : 'var(--text-body)',
                  fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13,
                }}>{label}</button>
              );
            })}
          </div>
        </div>
      </Section>
      <div style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>Caveatly · v0.1 · settings sync locally</div>
    </div>
  );
}
