// Build the report object the popup renders. Grade and stats are computed
// deterministically from the model's flags so the meter is always consistent.
const TIER_ORDER = { concern: 0, caution: 1, safe: 2 };

const HEADLINES = {
  A: 'Nothing alarming in the fine print.',
  B: 'Mostly fair — a few things to know.',
  C: 'Read carefully before you sign up.',
  D: 'Serious concerns in these terms.',
  F: 'This fine print is stacked against you.',
};

// Concerns drive the letter; cautions only nudge within a band. Routine
// industry language (arbitration, change-of-terms, cookies) should not pin
// every mainstream site at C — 0–1 real concerns is A/B territory.
export function computeGrade(stats) {
  const c = stats.concern;
  const a = stats.caution;
  if (c >= 4) return 'F';
  if (c >= 3) return 'D';
  if (c === 2) return a >= 5 ? 'D' : 'C';
  if (c === 1) return a >= 6 ? 'C' : 'B';
  // 0 concerns
  if (a <= 2) return 'A';
  if (a <= 5) return 'B';
  return 'C';
}

export function buildReport({ site, title, docLabels, flags }) {
  const sorted = [...flags].sort((a, b) => (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3));
  const stats = {
    clauses: sorted.length,
    safe: sorted.filter(f => f.tier === 'safe').length,
    caution: sorted.filter(f => f.tier === 'caution').length,
    concern: sorted.filter(f => f.tier === 'concern').length,
  };
  const grade = computeGrade(stats);
  return {
    site,
    title,
    grade,
    headline: HEADLINES[grade],
    scannedAt: docLabels.join(' · '),
    stats,
    segments: [
      { label: 'Safe', value: stats.safe, color: 'var(--safe-500)' },
      { label: 'Caution', value: stats.caution, color: 'var(--caution-500)' },
      { label: 'Concern', value: stats.concern, color: 'var(--concern-500)' },
    ],
    flags: sorted,
    fetchedAt: Date.now(),
  };
}
