// Finds and fetches a site's terms of service and privacy policy for a scan.
// Order: the open page itself (if it is a policy) → links on the page →
// links on the site's homepage (and parent domains) → well-known paths like
// /privacy, kept only when the text reads like that policy → as a last resort,
// a cookie policy or legal index page.
import { fetchDocText, fetchDocTextBest, HUB_MAX_CHARS, MIN_DOC_CHARS } from './doc-fetch.js';
import {
  isBotWall, kindOfTitle, linksFromHtml, looksLikePolicyText, pickLegalCandidates, pickLegalHub, rankLegalLinks,
} from './legal-links.js';

const KINDS = ['terms', 'privacy'];
const MAX_FALLBACK_ORIGINS = 3;
const HOMEPAGE_TIMEOUT_MS = 10000;
const WELL_KNOWN = {
  privacy: ['/privacy', '/privacy-policy', '/legal/privacy', '/policies/privacy', '/privacy/policy', '/legal/privacy-policy', '/datenschutz'],
  terms: ['/terms', '/terms-of-service', '/terms-of-use', '/tos', '/legal/terms', '/policies/terms', '/legal/terms-of-service', '/agb'],
};
const TRUNCATION_NOTE = '\n[… truncated]';

export function docLabel(kind, linkText) {
  if (kind === 'privacy') return 'Privacy Policy';
  if (kind === 'terms') return 'Terms of Service';
  return linkText || 'Legal';
}

// Subdomains (tools.usps.com, store.github.com) often omit footer legal links.
// Walk the origin, then apex / www.apex so we can still find the site's policies.
// Naive eTLD+1 (last two labels) — good enough for .com/.org/.net; multi-part
// public suffixes (co.uk) may over-strip, which only costs an extra failed fetch.
export function relatedOrigins(origin) {
  let u;
  try { u = new URL(origin); } catch { return [origin]; }
  const host = u.hostname.replace(/^www\./i, '');
  const parts = host.split('.').filter(Boolean);
  const out = [];
  const port = u.port ? `:${u.port}` : '';
  const add = (h) => {
    const o = `${u.protocol}//${h}${port}`;
    if (!out.includes(o)) out.push(o);
  };
  add(u.hostname);
  if (parts.length >= 2) {
    const apex = parts.slice(-2).join('.');
    add(apex);
    add(`www.${apex}`);
  }
  // Also try peeling one label at a time (a.b.example.com → b.example.com → …)
  for (let i = 1; i < parts.length - 1; i++) {
    add(parts.slice(i).join('.'));
    add(`www.${parts.slice(i).join('.')}`);
  }
  return out;
}

// Policy links from a homepage's HTML (deep pages and app pages often lack them).
async function fetchLinks(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOMEPAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: 'include', redirect: 'follow', signal: controller.signal });
    if (!res.ok) return [];
    return linksFromHtml(await res.text(), res.url || url);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function homepageCandidates(origin, excludeUrl) {
  return pickLegalCandidates(await fetchLinks(`${origin}/`), excludeUrl);
}

// Missing kinds from the site's "Legal" index page, if the page links one.
async function legalHubCandidates(links, pageUrl, kinds) {
  const hub = pickLegalHub(links, pageUrl);
  if (!hub) return [];
  return pickLegalCandidates(await fetchLinks(hub), hub).filter(c => kinds.includes(c.kind));
}

export async function fallbackCandidates(origin, excludeUrl, kinds = KINDS) {
  const found = new Map();
  for (const o of relatedOrigins(origin).slice(0, MAX_FALLBACK_ORIGINS)) {
    for (const c of await homepageCandidates(o, excludeUrl)) {
      if (kinds.includes(c.kind) && !found.has(c.kind)) found.set(c.kind, c);
    }
    if (kinds.every(k => found.has(k))) break;
  }
  return [...found.values()];
}

// Guess /privacy, /terms, ... on the site and its apex. Guessed pages are only
// kept when their text reads like that kind of policy (a 200 "page not found"
// or a marketing page must not be analyzed).
async function wellKnownDoc(origin, kind) {
  const bases = relatedOrigins(origin).slice(0, 2);
  const urls = bases.flatMap(base => WELL_KNOWN[kind].map(p => `${base}${p}`));
  const results = await Promise.all(urls.map(async url => ({ url, ...(await fetchDocText(url)) })));
  const hit = results.find(r => r.text && looksLikePolicyText(r.text, kind));
  return hit ? { url: hit.url, text: hit.text, kind } : null;
}

// A PDF open in Chrome's viewer can't be scripted, so fetch it ourselves and
// treat it like a page whose text is the document.
export async function pdfTabExtract(url) {
  const u = new URL(url);
  const { text } = await fetchDocText(url);
  const name = decodeURIComponent(u.pathname.split('/').pop() || '');
  return {
    extracted: {
      url, origin: u.origin, hostname: u.hostname.replace(/^www\./, ''), title: name,
      isPdf: true, looksLegal: Boolean(text), pageText: text, links: [],
    },
  };
}

function pageAsDoc(extracted) {
  if (!extracted.looksLegal || !extracted.pageText) return null;
  const text = extracted.pageText;
  if (text.length < MIN_DOC_CHARS || isBotWall(text) || !looksLikePolicyText(text)) return null;
  const kind = kindOfTitle(extracted.title, extracted.url)
    || (extracted.isPdf ? (looksLikePolicyText(text, 'privacy') ? 'privacy' : 'terms') : null);
  if (!kind) return null;
  return { kind, label: docLabel(kind), url: extracted.url, text };
}

// A short page that links onward to the same kind of document is a hub
// (Facebook's /policies, Airbnb's privacy landing page): follow it once.
// Hubs often list several equally named links (a topic page and the policy
// itself), so the best two are read and the longer policy-like text wins.
const HUB_FOLLOW_LINKS = 2;

async function fetchFollowingHub(c, tabId, tried) {
  const first = await fetchDocTextBest(c.url, tabId);
  const hubLike = !first.text || first.text.length < HUB_MAX_CHARS || !looksLikePolicyText(first.text, c.kind);
  if (!hubLike || !first.links?.length) return { ...first, url: c.url };
  const next = rankLegalLinks(first.links, first.finalUrl || c.url, c.kind)
    .filter(n => !tried.has(n.url) && n.url !== c.url)
    .slice(0, HUB_FOLLOW_LINKS);
  if (!next.length) return { ...first, url: c.url };
  for (const n of next) tried.add(n.url);
  const followed = await Promise.all(next.map(async n => ({ ...(await fetchDocTextBest(n.url, tabId)), url: n.url })));
  const best = followed
    .filter(f => f.text && (!first.text || f.text.length > first.text.length))
    .sort((a, b) => Number(looksLikePolicyText(b.text, c.kind)) - Number(looksLikePolicyText(a.text, c.kind)) || b.text.length - a.text.length)[0];
  if (best) return best;
  const reasons = followed.map(f => `hub ${f.url}: ${f.reason || 'not longer'}`).join('; ');
  return first.text ? { ...first, url: c.url } : { ...first, url: c.url, reason: `${first.reason}; ${reasons}` };
}

async function fetchCandidates(candidates, tabId, tried) {
  const fresh = candidates.filter(c => !tried.has(c.url));
  for (const c of fresh) tried.add(c.url);
  const fetched = await Promise.all(fresh.map(async c => ({ c, ...(await fetchFollowingHub(c, tabId, tried)) })));
  return {
    docs: fetched.filter(f => f.text).map(f => ({ kind: f.c.kind, label: docLabel(f.c.kind, f.c.text), url: f.url, text: f.text })),
    failures: fetched.filter(f => !f.text).map(f => ({ url: f.c.url, kind: f.c.kind, reason: f.reason })),
  };
}

const missingKinds = docs => KINDS.filter(k => !docs.some(d => d.kind === k));

/**
 * Returns { docs, candidates, failures }. docs: [{ kind, label, url, text }].
 * candidates: the links picked from the page. failures: what could not be read.
 */
export async function gatherDocs(extracted, tabId) {
  const pageUrl = extracted.url.split('#')[0];
  const tried = new Set([pageUrl]);
  const pageDoc = pageAsDoc(extracted);
  let docs = pageDoc ? [pageDoc] : [];
  let failures = [];
  const add = result => {
    docs = [...docs, ...result.docs.filter(d => !docs.some(x => x.url === d.url || x.kind === d.kind))];
    failures = [...failures, ...result.failures];
  };

  // A PDF is scanned on its own: the user asked about this document.
  if (extracted.isPdf) return { docs, candidates: [], failures };

  const pagePicks = pickLegalCandidates(extracted.links, pageUrl);
  const candidates = pagePicks.filter(c => c.kind !== 'legal');
  add(await fetchCandidates(candidates.filter(c => missingKinds(docs).includes(c.kind)), tabId, tried));

  if (missingKinds(docs).length) {
    add(await fetchCandidates(await legalHubCandidates(extracted.links, pageUrl, missingKinds(docs)), tabId, tried));
  }
  if (missingKinds(docs).length) {
    add(await fetchCandidates(await fallbackCandidates(extracted.origin, pageUrl, missingKinds(docs)), tabId, tried));
  }
  if (missingKinds(docs).length) {
    const guessed = await Promise.all(missingKinds(docs).map(kind => wellKnownDoc(extracted.origin, kind)));
    add({ docs: guessed.filter(Boolean).filter(g => !tried.has(g.url)).map(g => ({ ...g, label: docLabel(g.kind) })), failures: [] });
  }
  if (!docs.length) {
    add(await fetchCandidates(pagePicks.filter(c => c.kind === 'legal'), tabId, tried));
  }
  return { docs, candidates: pagePicks, failures };
}

function truncateAt(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - TRUNCATION_NOTE.length);
  const para = cut.lastIndexOf('\n\n');
  return `${para > limit * 0.8 ? cut.slice(0, para) : cut}${TRUNCATION_NOTE}`;
}

/**
 * Shares the AI's character budget fairly between documents, so one very long
 * policy (eBay's terms run to 145k chars) cannot crowd out the other.
 */
export function fitDocs(docs, budget) {
  const total = docs.reduce((n, d) => n + d.text.length, 0);
  if (!budget || total <= budget) return docs;
  let remaining = budget;
  const limits = new Map();
  const sorted = [...docs].sort((a, b) => a.text.length - b.text.length);
  sorted.forEach((d, i) => {
    const share = Math.floor(remaining / (sorted.length - i));
    const limit = Math.min(d.text.length, share);
    limits.set(d, limit);
    remaining -= limit;
  });
  return docs.map(d => ({ ...d, text: truncateAt(d.text, limits.get(d)) }));
}
