import React from 'react';

/** Small category tag (e.g. "Tracking", "Cookies", "Content licensing"). */
export function Chip({ children, tone = 'neutral', iconLeft = null, style = {} }) {
  const tones = {
    neutral: { bg: 'var(--surface-sunken)', fg: 'var(--text-body)', bd: 'var(--border-default)' },
    brand: { bg: 'var(--teal-50)', fg: 'var(--teal-700)', bd: 'var(--teal-100)' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 'var(--radius-pill)',
      background: t.bg, border: `1px solid ${t.bd}`, color: t.fg,
      fontFamily: 'var(--font-sans)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-sm)',
      lineHeight: 1, whiteSpace: 'nowrap', ...style,
    }}>
      {iconLeft}
      {children}
    </span>
  );
}
