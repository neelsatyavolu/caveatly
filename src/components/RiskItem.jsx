import React from 'react';
import { ChevronRight } from 'lucide-react';
import { TIERS, RiskBadge } from './RiskBadge.jsx';

/** A single flagged clause: tier keyline + plain-English title, explanation, legal ref.
    When a verbatim `quote` is present, the row expands to show it highlighter-style. */
export function RiskItem({ tier = 'caution', title, explanation, clauseRef, quote, expandable = false, style = {}, onClick }) {
  const [hover, setHover] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const t = TIERS[tier] || TIERS.caution;
  const canExpand = Boolean(quote) && expandable;
  const clickable = canExpand || onClick;
  const handleClick = canExpand ? () => setOpen(o => !o) : onClick;
  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start',
        padding: 'var(--space-4) var(--space-5)',
        background: hover && clickable ? 'var(--surface-sunken)' : 'var(--surface-card)',
        borderLeft: `3px solid ${t.dot}`,
        borderBottom: '1px solid var(--border-subtle)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background var(--dur-fast) var(--ease-out)',
        ...style,
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <RiskBadge tier={tier} size="sm" />
          {clauseRef && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{clauseRef}</span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-body)', color: 'var(--text-strong)', lineHeight: 'var(--lh-snug)' }}>{title}</div>
        {explanation && (
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)', marginTop: 2 }}>{explanation}</div>
        )}
        {canExpand && open && (
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--marker-yellow-soft)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 'var(--lh-normal)' }}>
            “{quote}”
          </div>
        )}
      </div>
      {clickable && (
        <span style={{ color: 'var(--text-faint)', flex: '0 0 auto', marginTop: 2, transform: canExpand && open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }}>
          <ChevronRight size={18} />
        </span>
      )}
    </div>
  );
}
