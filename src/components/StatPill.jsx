import React from 'react';
import { TIERS } from './RiskBadge.jsx';

/** Big count + label, tinted by tier — the report summary header stats. */
export function StatPill({ count, label, tier = null, style = {} }) {
  const t = tier ? (TIERS[tier] || null) : null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'var(--space-4) var(--space-5)', minWidth: 78,
      background: t ? t.tint : 'var(--surface-sunken)',
      border: `1px solid ${t ? t.border : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-md)', ...style,
    }}>
      <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 'var(--fw-semibold)', fontSize: '1.75rem', lineHeight: 1, color: t ? t.text : 'var(--text-strong)' }}>{count}</span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-bold)', letterSpacing: 'var(--ls-label)', textTransform: 'uppercase', color: t ? t.text : 'var(--text-muted)', marginTop: 4 }}>{label}</span>
    </div>
  );
}
