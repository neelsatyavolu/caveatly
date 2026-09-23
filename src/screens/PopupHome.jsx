import React from 'react';
import { ArrowRight, Cookie, Globe, KeyRound, ScanSearch, Settings, TriangleAlert } from 'lucide-react';
import { Button } from '../components/Button.jsx';
import { IconButton } from '../components/IconButton.jsx';
import { StatPill } from '../components/StatPill.jsx';
import { SiteIcon } from '../components/SiteIcon.jsx';

const GRADE_STYLE = {
  A: { tint: 'var(--safe-tint)', color: 'var(--safe-600)' },
  B: { tint: 'var(--safe-tint)', color: 'var(--safe-600)' },
  C: { tint: 'var(--caution-tint)', color: 'var(--caution-600)' },
  D: { tint: 'var(--concern-tint)', color: 'var(--concern-600)' },
  F: { tint: 'var(--critical-tint)', color: 'var(--critical-700)' },
};

function EmptyState({ icon, headline, body, action }) {
  return (
    <div style={{ padding: '26px 6px 30px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-faint)', marginBottom: 10 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, color: 'var(--text-strong)' }}>{headline}</div>
      {body && <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '6px 12px 0' }}>{body}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function PopupHome({ report, status, errorMessage, site, siteUrl, cookieFooter, onScan, onOpenReport, onOpenSettings }) {
  const top = report ? report.flags.filter(f => f.tier === 'concern').slice(0, 3) : [];
  const topLabel = top.length ? 'Top concerns' : 'Top findings';
  const shown = top.length ? top : (report ? report.flags.slice(0, 3) : []);
  const g = report ? (GRADE_STYLE[report.grade] || GRADE_STYLE.C) : null;
  return (
    <div style={{ width: '100%', background: 'var(--surface-page)', fontFamily: 'var(--font-sans)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--teal-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 100 100" width="16" height="16" fill="none" stroke="#fff" strokeWidth="15" strokeLinecap="round" aria-hidden="true">
              <path d="M50 18v64" /><path d="M22.3 34 77.7 66" /><path d="M22.3 66 77.7 34" />
            </svg>
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 18, color: 'var(--text-strong)', letterSpacing: '-0.02em' }}>Caveatly</span>
        </div>
        <IconButton label="Settings" onClick={onOpenSettings}><Settings size={18} /></IconButton>
      </div>

      {/* site + body */}
      <div style={{ padding: '16px 16px 4px' }}>
        {site && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <SiteIcon pageUrl={siteUrl} size={30} />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-strong)' }}>{site}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{report ? report.scannedAt : 'Not scanned yet'}</div>
            </div>
          </div>
        )}

        {status === 'scanning' && (
          <div style={{ padding: '26px 0 30px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, color: 'var(--text-body)' }}>Reading the fine print…</div>
            <div style={{ marginTop: 12, height: 6, background: 'var(--surface-sunken)', borderRadius: 999, overflow: 'hidden' }}>
              <div className="fp-progress" style={{ width: '62%', height: '100%', background: 'var(--accent)', borderRadius: 999 }}></div>
            </div>
          </div>
        )}

        {status === 'needs-key' && (
          <EmptyState
            icon={<KeyRound size={26} />}
            headline="Connect your Gemini API key"
            body="Caveatly uses Gemini to read terms & policies. Add your key once in settings to start scanning."
            action={<Button onClick={onOpenSettings} iconRight={<ArrowRight size={17} />}>Open settings</Button>}
          />
        )}

        {status === 'idle' && (
          <EmptyState
            icon={<ScanSearch size={26} />}
            headline="Ready to read the fine print."
            body="Scan this page to flag what its terms and privacy policy really say."
            action={<Button onClick={onScan} iconRight={<ArrowRight size={17} />}>Scan this page</Button>}
          />
        )}

        {status === 'no-tab' && (
          <EmptyState icon={<Globe size={26} />} headline="Open a website first" body="Caveatly scans regular web pages — switch to a site and try again." />
        )}

        {status === 'error' && (
          <EmptyState
            icon={<TriangleAlert size={26} style={{ color: 'var(--concern-600)' }} />}
            headline="Couldn't finish the scan"
            body={errorMessage || 'Something went wrong.'}
            action={<Button variant="secondary" onClick={onScan}>Try again</Button>}
          />
        )}

        {status === 'ready' && report && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 2px 16px' }}>
              <div style={{ width: 64, height: 64, flex: '0 0 auto', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: g.tint, border: `2px solid ${g.color}`, fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 34, color: g.color }}>{report.grade}</div>
              <div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--text-strong)', lineHeight: 1.25 }}>{report.headline}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  {report.stats.concern > 0 ? `${report.stats.concern} concern${report.stats.concern === 1 ? '' : 's'} worth your attention.` : `${report.stats.clauses} clauses reviewed.`}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <StatPill count={report.stats.clauses} label="Clauses" style={{ flex: 1 }} />
              <StatPill count={report.stats.caution} label="Caution" tier="caution" style={{ flex: 1 }} />
              <StatPill count={report.stats.concern} label="Concern" tier="concern" style={{ flex: 1 }} />
            </div>

            {shown.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '4px 2px 8px' }}>{topLabel}</div>
                <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 14 }}>
                  {shown.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 11px', borderLeft: `3px solid var(--${f.tier}-600)`, borderBottom: i < shown.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: `var(--${f.tier}-600)`, marginTop: 6, flex: '0 0 auto' }}></span>
                      <span style={{ lineHeight: 1.35 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{f.title}</span>
                        {f.explanation && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.4 }}>{f.explanation}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Button fullWidth iconRight={<ArrowRight size={17} />} onClick={onOpenReport}>See full report</Button>
            <button onClick={onScan} style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: 'var(--text-link)', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 6 }}>Re-scan this page</button>
          </>
        )}
      </div>

      {/* cookie footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', marginTop: 8, background: cookieFooter.on ? 'var(--safe-tint)' : 'var(--surface-sunken)', borderTop: `1px solid ${cookieFooter.on ? 'var(--safe-border)' : 'var(--border-subtle)'}`, color: cookieFooter.on ? 'var(--safe-600)' : 'var(--text-muted)' }}>
        <Cookie size={16} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{cookieFooter.text}</span>
      </div>
    </div>
  );
}
