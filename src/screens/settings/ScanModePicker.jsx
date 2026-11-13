import React from 'react';

const MODES = [['off', 'Off'], ['ask', 'Ask first'], ['auto', 'Auto-scan']];
const MODE_NOTE = {
  auto: 'Auto-scan is on: Caveatly scans and opens the report.',
  ask: 'Ask first: a small prompt offers to scan.',
  off: 'Off: no on-page prompts or scans.',
};

export function ScanModePicker({ value, onChange }) {
  return (
    <div>
      <div id="fp-scan-mode" style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)', color: 'var(--text-strong)' }}>When Caveatly finds terms or a privacy policy</div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 1, marginBottom: 9 }}>
        Only on sites you have not scanned yet. Opening the toolbar never starts a scan by itself. {MODE_NOTE[value] || ''}
      </div>
      <div role="radiogroup" aria-labelledby="fp-scan-mode" style={{ display: 'flex', gap: 7 }}>
        {MODES.map(([mode, label]) => (
          <button
            key={mode}
            role="radio"
            aria-checked={value === mode}
            className="fp-segment"
            onClick={() => onChange(mode)}
          >{label}</button>
        ))}
      </div>
    </div>
  );
}
