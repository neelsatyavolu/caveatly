import React from 'react';

const base = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 'var(--fw-semibold)',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-3)',
  whiteSpace: 'nowrap',
  transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
  textDecoration: 'none',
  lineHeight: 1,
};

const sizes = {
  sm: { height: 'var(--control-sm)', padding: '0 12px', fontSize: 'var(--fs-sm)' },
  md: { height: 'var(--control-md)', padding: '0 16px', fontSize: 'var(--fs-body)' },
  lg: { height: 'var(--control-lg)', padding: '0 22px', fontSize: 'var(--fs-body-lg)' },
};

const variants = {
  primary: { background: 'var(--accent)', color: 'var(--on-accent)' },
  secondary: { background: 'var(--surface-card)', color: 'var(--text-strong)', borderColor: 'var(--border-strong)' },
  ghost: { background: 'transparent', color: 'var(--text-body)' },
  danger: { background: 'var(--concern-600)', color: '#fff' },
};

const hoverBg = { primary: 'var(--accent-hover)', danger: 'var(--critical-600)' };

/** Fineprint primary action button. */
export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  iconLeft = null,
  iconRight = null,
  children,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const v = variants[variant] || variants.primary;
  const s = { ...base, ...sizes[size], ...v };
  if (fullWidth) s.width = '100%';
  if (!disabled && hover) {
    if (variant === 'primary') s.background = hoverBg.primary;
    else if (variant === 'danger') s.background = hoverBg.danger;
    else if (variant === 'secondary') s.borderColor = 'var(--ink-400)';
    else if (variant === 'ghost') s.background = 'var(--surface-sunken)';
  }
  if (!disabled && press) {
    if (variant === 'primary') s.background = 'var(--accent-active)';
    s.transform = 'translateY(1px)';
  }
  if (disabled) { s.opacity = 0.45; s.cursor = 'not-allowed'; }
  return (
    <button
      style={{ ...s, ...style }}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
