// Host / origin helpers for policy fetches. No chrome.* so the cookie decision
// can be unit-tested. Cookies are sent only to the site being scanned — a page
// can link "Privacy policy" at any host, and that fetch must not carry the
// user's cookies for some other site.

// Multi-label public suffixes and user-content hosts. Not the full Public
// Suffix List — just enough that sibling tenants (a.github.io / b.github.io)
// are not treated as one site. Unknown suffixes fall back to the last two labels.
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'co.nz', 'co.za', 'co.in',
  'com.br', 'com.mx', 'com.tr', 'com.sg', 'com.hk',
  'github.io', 'githubusercontent.com', 'gitlab.io',
  'appspot.com', 'herokuapp.com', 'netlify.app', 'vercel.app',
  'pages.dev', 'web.app', 'firebaseapp.com',
  'blogspot.com', 'wordpress.com', 'azurewebsites.net',
  'cloudfront.net', 'ngrok.io', 'ngrok.app',
]);

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/\.$/, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Registrable-ish domain: example.com, amazon.co.uk, foo.github.io. */
export function apexHost(hostname) {
  const host = String(hostname || '').replace(/\.$/, '').toLowerCase().replace(/^www\./, '');
  // Addresses have no registrable domain. Last-two-label fallback would treat
  // 1.2.3.4 and 9.9.3.4 as the same site.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return host;
  const tail2 = parts.slice(-2).join('.');
  if (MULTI_SUFFIXES.has(tail2)) {
    return parts.length >= 3 ? parts.slice(-3).join('.') : host;
  }
  return tail2;
}

/** True when both URLs belong to the same site (same host or same registrable domain). */
export function sharesSite(aUrl, bUrl) {
  const a = hostnameOf(aUrl);
  const b = hostnameOf(bUrl);
  if (!a || !b) return false;
  if (a === b) return true;
  return apexHost(a) === apexHost(b) && apexHost(a).includes('.');
}

export function fetchCredentials(pageOrigin, url) {
  return sharesSite(pageOrigin, url) ? 'include' : 'omit';
}

// Subdomains often omit footer legal links. Walk this host, then its apex / www
// host. IP addresses and single-label hosts have no parent to try. Multi-part
// public suffixes are not stripped (foo.github.io does not become github.io).
export function relatedOrigins(origin) {
  let u;
  try { u = new URL(origin); } catch { return [origin]; }
  const rawHost = u.hostname.replace(/\.$/, '');
  const host = rawHost.replace(/^www\./i, '').toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || !host.includes('.')) {
    return [u.origin];
  }
  const out = [];
  const add = (h) => {
    const o = `${u.protocol}//${h}`;
    if (!out.includes(o)) out.push(o);
  };
  add(rawHost);
  const apex = apexHost(host);
  add(apex);
  add(`www.${apex}`);
  const parts = host.split('.').filter(Boolean);
  const apexParts = apex.split('.').filter(Boolean).length;
  // Peel labels down to the registrable domain, but not past a public suffix.
  for (let i = 1; i < parts.length - apexParts; i++) {
    const peeled = parts.slice(i).join('.');
    add(peeled);
    add(`www.${peeled}`);
  }
  return out;
}
