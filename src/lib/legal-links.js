// Decides which links point at a site's terms of service or privacy policy,
// and whether fetched text really is one. Used by the service worker for links
// collected from the open page (lib/extract-page.js) and from fetched homepages.
//
// Matching is on whole words (Unicode-aware) so "midterms" or a podcast called
// "Terms of Service with ..." do not count, and covers the common European
// languages. Imprints (Impressum, mentions légales, aviso legal) are NOT
// privacy policies, and cookie or "privacy choices" pages are only a last resort.

const W = '(?<![\\p{L}\\p{N}])';   // word start
const E = '(?![\\p{L}\\p{N}])';    // word end

const PRIVACY_WORDS = [
  'privacy', 'data[\\s-]?(?:protection|policy|privacy)', 'datenschutz\\p{L}*', 'confidentialit[ée]',
  'donn[ée]es personnelles', 'vie priv[ée]e', 'privacidad', 'privacidade', 'riservatezza',
  'privacybeleid', 'privacyverklaring', 'integritets\\p{L}*', 'personvern\\p{L}*', 'privatliv\\p{L}*',
  'prywatno\\p{L}*', 'gizlilik', 'конфиденциальн\\p{L}*',
];
const TERMS_WORDS = [
  'terms', 'conditions', 'user agreement', 'eula', 'nutzungsbedingungen', 'agb',
  '(?:allgemeine )?gesch[äa]ftsbedingungen', 'cgu', 'cgv', 'conditions g[ée]n[ée]rales', 't[ée]rminos',
  'condiciones', 'termini', 'condizioni', 'termos', 'gebruiksvoorwaarden', '(?:algemene )?voorwaarden',
  'villkor', 'vilkår', 'regulamin', 'kullanım koşulları', 'пользовательское соглашение', 'условия',
];
// Scripts without spaces between words: match anywhere.
const PRIVACY_CJK = ['プライバシー', '隐私', '隱私', '개인정보'];
const TERMS_CJK = ['利用規約', '服务条款', '服務條款', '이용약관', '使用条款'];

const wordsRx = (words, cjk) => new RegExp(`${W}(?:${words.join('|')})${E}|${cjk.join('|')}`, 'iu');

export const PRIVACY_TEXT = wordsRx(PRIVACY_WORDS, PRIVACY_CJK);
export const TERMS_TEXT = wordsRx(TERMS_WORDS, TERMS_CJK);

// Links that mention privacy/terms but are not the policy itself.
const NOT_POLICY_TEXT = new RegExp(`${W}(?:${[
  'impressum', 'imprint', 'mentions l[ée]gales', 'aviso legal', 'legal notice', 'colophon',
  'ad ?choices', 'do not sell', 'opt[\\s-]?out', 'your privacy choices', 'contact',
  'privacy (?:choices|settings|preferences|options|dashboard|checkup|request)',
  'manage', 'accessibility', 'dmca', 'copyright', 'trademark', 'law enforcement',
].join('|')})${E}`, 'iu');
// Cookie pages are a last resort, but "Privacy & Cookies" (Microsoft) is the policy.
const COOKIE_TEXT = /(?<![\p{L}])cookies?(?![\p{L}])/iu;
// News-style URLs (/2019/sep/12/...) are articles about privacy, not policies.
const ARTICLE_PATH = /\/(?:19|20)\d{2}\/(?:\d{1,2}|[a-z]{3,9})\//i;
// Terms for some side programme, not the service itself.
const QUALIFIED_TEXT = new RegExp(`${W}(?:${[
  'rewards?', 'program(?:me)?', 'promotions?', 'sweepstakes', 'contest', 'gift ?cards?', 'offers?',
  'sellers?', 'developers?', 'api', 'partners?', 'affiliates?', 'advertis\\p{L}*', 'suppliers?',
  'vendors?', 'employment', 'jobs?', 'careers?', 'recruit\\p{L}*', 'creators?', 'merchants?', 'podcasts?',
  'health', 'compare',
].join('|')})${E}`, 'iu');

const HREF_PRIVACY = /(?<![a-z])(?:privacy|datenschutz|confidentialite|privacidad|privacidade|data-?protection|privacybeleid)/i;
const HREF_TERMS = /(?<![a-z])(?:terms|tos(?![a-z])|conditions|agb(?![a-z])|cgu(?![a-z])|cgv(?![a-z])|nutzungsbedingungen|eula(?![a-z])|user-?agreement|terminos|condiciones|voorwaarden)/i;
const HREF_LEGAL = /(?<![a-z])(?:legal|policies|policy)(?![a-z])/i;
const HREF_NOT_POLICY = /(?<![a-z])(?:impressum|imprint|cookie|opt-?out|choices|cookieprefs|settings|adchoices|mentions-legales|aviso-legal)/i;

// Text that is only a document name ("Privacy", "Terms of Use", "Privacy &
// Cookies") beats a landing page like "Privacy at Microsoft".
const DOC_NAME_WORDS = /(?<![\p{L}])(?:policy|policies|notice|statement|of|use|service|services|and|our|the|user|cookies?|conditions|agreement|general|full)(?![\p{L}])|[&.,:|·-]/giu;
const isDocName = t => !t.replace(new RegExp(PRIVACY_TEXT.source, 'giu'), ' ').replace(new RegExp(TERMS_TEXT.source, 'giu'), ' ').replace(DOC_NAME_WORDS, ' ').trim();

const ARTICLE_TEXT_LEN = 60;
export const MIN_LINK_SCORE = 4;

function hrefPath(href) {
  try {
    const u = new URL(href);
    return decodeURIComponent(`${u.pathname}${u.search}`).replace(/[_+]/g, '-');
  } catch {
    return '';
  }
}

function siteOf(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
}

/**
 * Scores one link. Returns { kind: 'privacy'|'terms'|'legal', score } or null.
 * 'legal' covers cookie policies and legal index pages: used only when nothing better exists.
 */
export function classifyLegalLink({ text = '', href = '', inFooter = false }, pageUrl = '') {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const path = hrefPath(href);
  if (!path) return null;
  const textPrivacy = PRIVACY_TEXT.test(t);
  const textTerms = TERMS_TEXT.test(t);
  const hrefPrivacy = HREF_PRIVACY.test(path);
  const hrefTerms = HREF_TERMS.test(path);
  const notPolicy = NOT_POLICY_TEXT.test(t)
    || (!textPrivacy && !textTerms && (COOKIE_TEXT.test(t) || HREF_NOT_POLICY.test(path)));

  let kind = null;
  if (textPrivacy && !textTerms) kind = 'privacy';
  else if (textTerms && !textPrivacy) kind = 'terms';
  else if (textPrivacy && textTerms) kind = hrefPrivacy && !hrefTerms ? 'privacy' : hrefTerms && !hrefPrivacy ? 'terms' : 'privacy';
  else if (!t || t.length <= ARTICLE_TEXT_LEN) kind = hrefPrivacy ? 'privacy' : hrefTerms ? 'terms' : null;
  if (!kind && /(?<![\p{L}])(?:legal|cookies?)(?![\p{L}])/iu.test(t) && HREF_LEGAL.test(path)) kind = 'legal';
  if (!kind) return null;
  if (notPolicy && kind !== 'legal') return { kind: 'legal', score: 1 };

  let score = 0;
  if (textPrivacy || textTerms) score += t.length <= 40 ? 5 : t.length <= ARTICLE_TEXT_LEN ? 3 : 0;
  if ((textPrivacy || textTerms) && isDocName(t)) score += 4;
  if ((kind === 'privacy' && hrefPrivacy) || (kind === 'terms' && hrefTerms)) score += 3;
  if (HREF_LEGAL.test(path)) score += 1;
  if (inFooter) score += 2;
  if (t.length > ARTICLE_TEXT_LEN) score -= 3;
  if (ARTICLE_PATH.test(path)) score -= 4;
  if (QUALIFIED_TEXT.test(t) || QUALIFIED_TEXT.test(path.replace(/-/g, ' '))) score -= 6;
  try {
    if (pageUrl && siteOf(new URL(href).hostname) !== siteOf(new URL(pageUrl).hostname)) score -= 1;
  } catch { /* invalid page URL: no same-site adjustment */ }
  return { kind, score };
}

/** Links of one kind, strongest first (deduplicated, never the page itself). */
export function rankLegalLinks(links, pageUrl, kind) {
  const self = String(pageUrl).split('#')[0];
  const scored = new Map();
  for (const link of links || []) {
    const url = String(link.href || '').split('#')[0];
    if (!/^https?:/i.test(url) || url === self) continue;
    const c = classifyLegalLink(link, pageUrl);
    if (!c || c.kind !== kind || c.score < MIN_LINK_SCORE) continue;
    if (!scored.has(url) || scored.get(url) < c.score) scored.set(url, c.score);
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([url, score]) => ({ url, kind, score }));
}

/**
 * Best link per kind. links: [{ text, href, inFooter }]. Returns at most one
 * 'terms' and one 'privacy' candidate (plus one 'legal' when both are missing),
 * strongest first, never the page itself.
 */
export function pickLegalCandidates(links, pageUrl = '') {
  const self = String(pageUrl).split('#')[0];
  const best = new Map();
  for (const link of links || []) {
    const url = String(link.href || '').split('#')[0];
    if (!/^https?:/i.test(url) || url === self) continue;
    const c = classifyLegalLink(link, pageUrl);
    if (!c) continue;
    const minScore = c.kind === 'legal' ? 1 : MIN_LINK_SCORE;
    if (c.score < minScore) continue;
    const prev = best.get(c.kind);
    if (!prev || c.score > prev.score) {
      best.set(c.kind, { url, text: String(link.text || '').replace(/\s+/g, ' ').trim().slice(0, 80), kind: c.kind, score: c.score });
    }
  }
  const picked = ['terms', 'privacy'].filter(k => best.has(k)).map(k => best.get(k));
  if (!picked.length && best.has('legal')) picked.push(best.get('legal'));
  return picked;
}

const LEGAL_HUB_TEXT = /(?<![\p{L}])(?:legal|terms (?:&|and) privacy|privacy (?:&|and) terms|policies|rechtliches|juridique|mentions|legales?)(?![\p{L}])/iu;

/**
 * A "Legal" / "Terms & Privacy" index page linked from the page, used to find a
 * missing document (Spotify's web player links only to /legal/). Null if none.
 */
export function pickLegalHub(links, pageUrl = '') {
  const self = String(pageUrl).split('#')[0];
  const hub = (links || []).find(l => {
    const url = String(l.href || '').split('#')[0];
    const text = String(l.text || '').trim();
    return url !== self && /^https?:/i.test(url) && text.length <= 40
      && LEGAL_HUB_TEXT.test(text) && !NOT_POLICY_TEXT.test(text) && HREF_LEGAL.test(hrefPath(url));
  });
  return hub ? String(hub.href).split('#')[0] : null;
}

/** Anchor list from raw HTML (service worker has no DOMParser). */
export function linksFromHtml(html, baseUrl) {
  const out = [];
  const footerStart = Math.max(html.search(/<footer\b/i), 0) || html.length;
  const anchor = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let m;
  while ((m = anchor.exec(html)) && out.length < 5000) {
    let href;
    try { href = new URL(m[1].replace(/&amp;/g, '&'), baseUrl).href; } catch { continue; }
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    out.push({ text, href, inFooter: footerStart < html.length && m.index >= footerStart });
  }
  return out;
}

const PRIVACY_BODY = /personal (?:data|information)|personenbezogene|données personnelles|datos personales|dati personali|dados pessoais|persoonsgegevens|we collect|information we collect|third part(?:y|ies)|cookies|retention|your rights|data controller|processing|GDPR|CCPA|opt[ -]out|Datenschutz|confidentialité|privacidad/gi;
const TERMS_BODY = /\bagree(?:ment)?\b|liabilit(?:y|ies)|warrant(?:y|ies)|governing law|terminat(?:e|ion)|indemnif|dispute|arbitration|license|you may not|intellectual property|Haftung|Vertrag|responsabilité|responsabilidad|jurisdic|accept/gi;

/** True when text reads like a policy of that kind (used to validate guessed URLs). */
export function looksLikePolicyText(text, kind) {
  if (!text) return false;
  const sample = text.slice(0, 40000);
  const hits = rx => new Set((sample.match(rx) || []).map(s => s.toLowerCase())).size;
  if (kind === 'privacy') return hits(PRIVACY_BODY) >= 3;
  if (kind === 'terms') return hits(TERMS_BODY) >= 3;
  return hits(PRIVACY_BODY) >= 3 || hits(TERMS_BODY) >= 3;
}

/** Kind of a policy document from its title/URL, or null when it is not one. */
export function kindOfTitle(title, url) {
  const path = hrefPath(url);
  if (NOT_POLICY_TEXT.test(title || '') && !PRIVACY_TEXT.test(title || '') && !TERMS_TEXT.test(title || '')) return null;
  if (PRIVACY_TEXT.test(title || '') || HREF_PRIVACY.test(path)) return 'privacy';
  if (TERMS_TEXT.test(title || '') || HREF_TERMS.test(path)) return 'terms';
  return null;
}

// Bot walls and captcha shells that come back with 200/403 instead of the document.
const BOT_WALL = /enable JS and disable any ad ?blocker|automated access to Amazon data|api-services-support@amazon\.com|captcha-delivery|Just a moment\.\.\.|Checking your browser|Access Denied|Attention Required!|verify you are (?:a )?human|unusual traffic|Pardon Our Interruption|Prove your humanity|identified as automated|identifi[ée] comme automatis[ée]|Robot or human\?|Request unsuccessful\. Incapsula/i;

export function isBotWall(text) {
  return BOT_WALL.test(String(text || '').slice(0, 3000));
}

const LOGIN_PATH = /(?<![a-z])(?:login|log-in|signin|sign-in|sign_in|auth|sso|account\/?login|checkpoint)(?![a-z])/i;

/** A policy URL that redirected to a sign-in page. */
export function isLoginRedirect(requestedUrl, finalUrl) {
  if (!finalUrl || finalUrl === requestedUrl) return false;
  return LOGIN_PATH.test(hrefPath(finalUrl)) && !LOGIN_PATH.test(hrefPath(requestedUrl));
}

// Broad page-side prefilter (sent to the injected extractor as regex sources).
export const LINK_PREFILTER_SOURCE = `${PRIVACY_TEXT.source}|${TERMS_TEXT.source}|(?<![\\p{L}])(?:legal|cookies?|polic(?:y|ies))(?![\\p{L}])`;
export const HREF_PREFILTER_SOURCE = `${HREF_PRIVACY.source}|${HREF_TERMS.source}|${HREF_LEGAL.source}`;
export const PRIVACY_TEXT_SOURCE = PRIVACY_TEXT.source;
export const TERMS_TEXT_SOURCE = TERMS_TEXT.source;
