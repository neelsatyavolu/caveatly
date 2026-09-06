import React from 'react';

export const TIERS = {
  safe:     { label: 'Safe',     dot: 'var(--safe-600)',     text: 'var(--safe-600)',     tint: 'var(--safe-tint)',     border: 'var(--safe-border)' },
  caution:  { label: 'Caution',  dot: 'var(--caution-600)',  text: 'var(--caution-600)',  tint: 'var(--caution-tint)',  border: 'var(--caution-border)' },
  concern:  { label: 'Concern',  dot: 'var(--concern-600)',  text: 'var(--concern-600)',  tint: 'var(--concern-tint)',  border: 'var(--concern-border)' },
  critical: { label: 'Critical', dot: 'var(--critical-600)', text: 'var(--critical-700)', tint: 'var(--critical-tint)', border: 'var(--critical-border)' },
};

/** Pill badge encoding a risk tier — the product's signature indicator. */
export function RiskBadge({ tier = 'caution', children, showDot = true, size = 'md', style = {} }) {
  const t = TIERS[tier] || TIERS.caution;
  const pad = size === 'sm' ? '2px 8px' : '3px 10px';
  const fs = size === 'sm' ? '10px' : 'var(--fs-xs)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: pad, borderRadius: 'var(--radius-pill)',
      background: t.tint, border: `1px solid ${t.border}`,
      color: t.text, fontFamily: 'var(--font-sans)', fontWeight: 'var(--fw-bold)',
      fontSize: fs, letterSpacing: 'var(--ls-label)', textTransform: 'uppercase',
      lineHeight: 1, whiteSpace: 'nowrap', ...style,
    }}>
      {showDot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, flex: '0 0 auto' }} />}
      {children || t.label}
    </span>
  );
}
