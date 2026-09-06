import React from 'react';

/** On/off switch — cookie & enhancement settings. */
export function Toggle({ checked = false, onChange, disabled = false, label, description, style = {} }) {
  const track = {
    width: 40, height: 22, borderRadius: 'var(--radius-pill)', flex: '0 0 auto',
    background: checked ? 'var(--accent)' : 'var(--ink-300)',
    transition: 'background var(--dur-med) var(--ease-out)',
    position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
  const knob = {
    position: 'absolute', top: 2, left: checked ? 20 : 2,
    width: 18, height: 18, borderRadius: '50%', background: '#fff',
    boxShadow: 'var(--shadow-sm)', transition: 'left var(--dur-med) var(--ease-out)',
  };
  const row = (
    <button
      role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{ border: 'none', background: 'none', padding: 0, ...track }}
    >
      <span style={knob} />
    </button>
  );
  if (!label) return <span style={style}>{row}</span>;
  return (
    <label style={{ display: 'flex', gap: 'var(--space-4)', alignItems: description ? 'flex-start' : 'center', cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      <span style={{ marginTop: description ? 1 : 0 }}>{row}</span>
      <span>
        <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)', color: 'var(--text-strong)' }}>{label}</span>
        {description && <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 1 }}>{description}</span>}
      </span>
    </label>
  );
}
