import React from 'react';

/** Overall trust grade: a big letter grade + a segmented tier-distribution bar. */
export function ProgressMeter({ grade = 'B', segments = [], caption, style = {} }) {
  const gradeColor = {
    A: 'var(--safe-600)', B: 'var(--safe-600)', C: 'var(--caution-600)',
    D: 'var(--concern-600)', F: 'var(--critical-700)',
  }[String(grade).charAt(0).toUpperCase()] || 'var(--text-strong)';
  const total = segments.reduce((a, s) => a + (s.value || 0), 0) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', ...style }}>
      <div style={{
        width: 56, height: 56, flex: '0 0 auto', borderRadius: 'var(--radius-md)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface-sunken)', border: `2px solid ${gradeColor}`,
        fontFamily: 'var(--font-serif)', fontWeight: 'var(--fw-semibold)', fontSize: '2rem',
        color: gradeColor, lineHeight: 1,
      }}>{grade}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', height: 10, borderRadius: 'var(--radius-pill)', overflow: 'hidden', background: 'var(--surface-sunken)' }}>
          {segments.map((s, i) => (
            <div key={i} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
          ))}
        </div>
        {caption && <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 8 }}>{caption}</div>}
      </div>
    </div>
  );
}
