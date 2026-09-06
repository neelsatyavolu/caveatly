import React from 'react';

const sizes = { sm: 28, md: 36, lg: 44 };

/** Square icon-only button. Pass a Lucide icon or SVG as children. */
export function IconButton({ size = 'md', variant = 'ghost', active = false, label, children, style = {}, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const d = sizes[size] || sizes.md;
  const s = {
    width: d, height: d,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    background: 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
  };
  if (variant === 'outline') { s.borderColor = 'var(--border-default)'; s.background = 'var(--surface-card)'; }
  if (hover) { s.background = 'var(--surface-sunken)'; s.color = active ? 'var(--accent-hover)' : 'var(--text-strong)'; }
  return (
    <button aria-label={label} title={label} style={{ ...s, ...style }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} {...rest}>
      {children}
    </button>
  );
}
