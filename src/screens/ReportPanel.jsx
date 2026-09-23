import React from 'react';
import { ArrowLeft, Check, Share2 } from 'lucide-react';
import { IconButton } from '../components/IconButton.jsx';
import { RiskItem } from '../components/RiskItem.jsx';
import { ProgressMeter } from '../components/ProgressMeter.jsx';
import { SiteIcon } from '../components/SiteIcon.jsx';

const TABS = ['All', 'Concern', 'Caution', 'Safe'];

function reportAsText(report) {
  const lines = [
    `Caveatly report — ${report.site} (grade ${report.grade})`,
    `${report.scannedAt}`,
    `${report.stats.clauses} clauses flagged · ${report.stats.concern} concern · ${report.stats.caution} caution · ${report.stats.safe} safe`,
    '',
    ...report.flags.map(f => `[${f.tier.toUpperCase()}] ${f.title}${f.clauseRef ? ` (${f.clauseRef})` : ''}${f.explanation ? ` — ${f.explanation}` : ''}`),
  ];
  return lines.join('\n');
}

export function ReportPanel({ report, siteUrl, onBack }) {
  const [tab, setTab] = React.useState('All');
  const [copied, setCopied] = React.useState(false);
  const flags = report.flags.filter(f => tab === 'All' ? true : f.tier === tab.toLowerCase());
  const share = async () => {
    try {
      await navigator.clipboard.writeText(reportAsText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable — ignore */ }
  };
  return (
    <div style={{ width: '100%', height: 560, display: 'flex', flexDirection: 'column', background: 'var(--surface-page)', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
        <IconButton label="Back" onClick={onBack}><ArrowLeft size={18} /></IconButton>
        <SiteIcon pageUrl={siteUrl} size={28} />
        <div style={{ flex: 1, lineHeight: 1.2 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-strong)' }}>{report.site}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{report.scannedAt}</div>
        </div>
        <IconButton label={copied ? 'Copied' : 'Copy report'} onClick={share} active={copied}>
          {copied ? <Check size={18} /> : <Share2 size={18} />}
        </IconButton>
      </div>

      {/* grade */}
      <div style={{ padding: '16px 16px 14px', background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)' }}>
        <ProgressMeter grade={report.grade} caption={`${report.stats.clauses} clauses flagged · ${report.stats.concern} concerns · ${report.stats.caution} caution`} segments={report.segments} />
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 7, padding: '12px 16px 10px', background: 'var(--surface-page)' }}>
        {TABS.map(t => {
          const active = t === tab;
          return <button key={t} onClick={() => setTab(t)} style={{ cursor: 'pointer', padding: '5px 12px', borderRadius: 999, border: '1px solid ' + (active ? 'var(--teal-600)' : 'var(--border-default)'), background: active ? 'var(--teal-600)' : 'var(--surface-card)', color: active ? '#fff' : 'var(--text-body)', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13 }}>{t}</button>;
        })}
      </div>

      {/* list */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)' }}>
        {flags.map((f, i) => (
          <RiskItem key={i} tier={f.tier} title={f.title} explanation={f.explanation} clauseRef={f.clauseRef} quote={f.quote} expandable />
        ))}
        {!flags.length && (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No {tab.toLowerCase()} findings on this page.</div>
        )}
      </div>
    </div>
  );
}
