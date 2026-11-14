import React from 'react';
import { Cookie, ShieldCheck, ShieldOff } from 'lucide-react';

// Brand teal for "on", muted ink for "off". Risk-tier colors stay reserved for risk.
const ON = 'var(--teal-700)';
const OFF = 'var(--text-muted)';

function adblockLine(adblock) {
  if (!adblock.enabled) return { on: false, text: 'Ad blocker is off', action: null };
  if (adblock.paused) return { on: false, text: 'Ad blocker paused on this site', action: 'Resume' };
  const n = adblock.blocked;
  const text = n == null ? 'Blocking ads and trackers'
    : n === 0 ? 'No ads or trackers on this page'
      : n === 1 ? '1 ad or tracker blocked'
        : `${n} ads and trackers blocked`;
  return { on: true, text, action: 'Pause on this site' };
}

function Row({ icon, on, children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, color: on ? ON : OFF }}>
      {icon}
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{children}</span>
      {action && (
        <button className="fp-text-button" onClick={onAction}>{action}</button>
      )}
    </div>
  );
}

/** Popup footer: ad blocker status with a per-site pause, then the cookie guard. */
export function ProtectionFooter({ adblock, cookieFooter, onTogglePause }) {
  const line = adblock ? adblockLine(adblock) : null;
  return (
    <div style={{ padding: '8px 16px 10px', marginTop: 8, background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)' }}>
      {line && (
        <Row
          on={line.on}
          icon={line.on ? <ShieldCheck size={16} aria-hidden="true" /> : <ShieldOff size={16} aria-hidden="true" />}
          action={line.action}
          onAction={onTogglePause}
        >
          {line.text}
        </Row>
      )}
      <Row on={cookieFooter.on} icon={<Cookie size={16} aria-hidden="true" />}>{cookieFooter.text}</Row>
    </div>
  );
}
