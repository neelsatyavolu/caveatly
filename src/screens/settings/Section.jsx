import React from 'react';
import { Toggle } from '../../components/Toggle.jsx';

export function Section({ title, id, children }) {
  return (
    <section id={id} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </section>
  );
}

// Why a Chrome-level setting can't be changed, from lib/browser-privacy.js status.
function lockNote(status) {
  if (!status || status.controllable) return null;
  return status.controlledByOther ? 'Another extension controls this.' : 'Managed by your organization.';
}

/** A settings toggle bound to one key. `status` (Chrome privacy prefs) hides
 *  unsupported toggles and locks ones Chrome won't let Caveatly change. */
export function SettingToggle({ settings, onSettingChange, name, label, description, status }) {
  if (status && status.supported === false) return null;
  const note = lockNote(status);
  return (
    <Toggle
      checked={Boolean(settings[name])}
      disabled={Boolean(note)}
      onChange={v => onSettingChange(name, v)}
      label={label}
      description={note ? `${description} ${note}` : description}
    />
  );
}
