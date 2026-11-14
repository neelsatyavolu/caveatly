import React from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PROVIDERS, DEFAULT_PROVIDER } from '../../lib/settings.js';

const SAVED_FLASH_MS = 1800;

export function ApiKeyField({ apiKeys, onSaveApiKey }) {
  const [draftKey, setDraftKey] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const preset = PROVIDERS[DEFAULT_PROVIDER];
  const hasKey = Boolean(apiKeys.gemini);
  const save = async () => {
    if (!draftKey.trim()) return;
    await onSaveApiKey(DEFAULT_PROVIDER, draftKey.trim());
    setDraftKey('');
    setSaved(true);
    setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  };
  return (
    <div>
      <label htmlFor="fp-api-key" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <KeyRound size={15} aria-hidden="true" style={{ color: hasKey ? 'var(--teal-700)' : 'var(--text-muted)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
          {hasKey ? 'Gemini API key connected' : 'Gemini API key'}
        </span>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="fp-api-key"
          className="fp-input"
          type="password"
          value={draftKey}
          onChange={e => setDraftKey(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder={hasKey ? '•••••••• (replace key)' : preset.keyHint}
        />
        <Button size="md" variant="secondary" disabled={!draftKey.trim()} onClick={save}>{saved ? 'Saved' : 'Save'}</Button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
        Needed only for reading the fine print. Free at aistudio.google.com, stored only on this device.
      </div>
    </div>
  );
}
