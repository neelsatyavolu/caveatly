// Injected into the page via chrome.scripting.executeScript({ func }).
// MUST stay self-contained: executeScript serializes the function, so it cannot
// reference anything outside its own body.
export function extractLegalSources() {
  const LEGAL = /(terms|conditions|privacy|polic(?:y|ies)|legal|eula|agreement|data.?protection|cookie)/i;
  const TERMS = /(terms|conditions|eula|agreement)/i;
  const PRIVACY = /(privacy|data.?protection)/i;

  const seen = new Set();
  const candidates = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!/^https?:/.test(href)) continue;
    const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!LEGAL.test(text) && !LEGAL.test(href)) continue;
    const key = href.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    // Prefer links whose visible text names the document over incidental URL matches.
    const score = (LEGAL.test(text) ? 2 : 0) + (TERMS.test(text) || TERMS.test(href) ? 1 : 0) + (PRIVACY.test(text) || PRIVACY.test(href) ? 1 : 0);
    const kind = PRIVACY.test(text) || PRIVACY.test(href) ? 'privacy' : (TERMS.test(text) || TERMS.test(href) ? 'terms' : 'legal');
    candidates.push({ url: key, text, kind, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  // Best candidate per kind, at most one terms + one privacy (fallback: top two overall).
  const picked = [];
  for (const kind of ['terms', 'privacy']) {
    const hit = candidates.find(c => c.kind === kind);
    if (hit) picked.push(hit);
  }
  for (const c of candidates) {
    if (picked.length >= 2) break;
    if (!picked.includes(c)) picked.push(c);
  }

  const looksLegal = LEGAL.test(document.title) || LEGAL.test(location.pathname);
  return {
    url: location.href,
    origin: location.origin,
    hostname: location.hostname.replace(/^www\./, ''),
    title: document.title,
    looksLegal,
    pageText: looksLegal ? (document.body.innerText || '').slice(0, 120000) : null,
    candidates: picked,
  };
}
