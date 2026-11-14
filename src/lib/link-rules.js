// Pure link-cleaning rules shared by the service worker (DNR rules) and the
// link-unwrap content script. No chrome.* here, so node can unit-test it.

// Query parameters that only identify a click, campaign or mail recipient for
// analytics and ad attribution. Pages never need them to render, so dropping
// them is safe. Deliberately absent: generic names that sites also use for real
// features (ref, source, si, trk, clickid, campid, spm, ...).
export const TRACKING_PARAMS = [
  // Google Analytics / Ads (utm_* is also matched by prefix in stripTrackingParams)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic', 'utm_name',
  'utm_brand', 'utm_social', 'utm_social-type', 'utm_cid', 'utm_reader', 'utm_viz_id',
  'utm_pubreferrer', 'utm_swu',
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid', '_gl', 'srsltid',
  // Meta
  'fbclid', 'igshid', 'igsh', 'mibextid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
  'action_object_map', 'action_type_map', 'action_ref_map',
  // Microsoft, X, TikTok, LinkedIn, Snapchat, Reddit, Quora, Yandex
  'msclkid', 'twclid', 'ttclid', 'li_fat_id', 'sccid', 'ScCid', 'rdt_cid', 'qclid', 'yclid', 'ysclid', '_openstat',
  // Email and marketing automation
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsCtaTracking',
  'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv', '_kx', 'ml_subscriber',
  'ml_subscriber_hash', 'dm_i', 'vgo_ee', 'nr_email_referer', 'wickedid',
  // Affiliate and other ad/analytics platforms
  'rb_clickid', 's_cid', 'sc_cid', 'ef_id', 'epik', 'irclid', 'irgwc', 'zanpid', 'cmpid', 'xtor',
  'wt_mc', 'WT.mc_id', 'mkevt', 'mkcid', 'mkrid',
  // Matomo / Piwik campaign tags
  'pk_campaign', 'pk_kwd', 'pk_source', 'pk_medium', 'pk_content',
  'mtm_campaign', 'mtm_keyword', 'mtm_source', 'mtm_medium', 'mtm_content', 'mtm_cid',
  'mtm_group', 'mtm_placement', 'piwik_campaign', 'piwik_kwd',
];

const TRACKING_PARAM_SET = new Set(TRACKING_PARAMS);

// Sign-in and payment providers. Their URLs can carry signed or one-time
// parameters, so link cleaning never rewrites them (any subdomain included).
export const PROTECTED_DOMAINS = [
  'accounts.google.com', 'accounts.youtube.com', 'pay.google.com', 'payments.google.com',
  'login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'account.live.com',
  'appleid.apple.com', 'idmsa.apple.com', 'signin.aws.amazon.com',
  'auth0.com', 'okta.com', 'oktapreview.com', 'onelogin.com', 'duosecurity.com',
  'paypal.com', 'stripe.com', 'braintreegateway.com', 'adyen.com', 'klarna.com',
  'squareup.com', 'pay.shopify.com', 'shop.app', 'affirm.com', 'afterpay.com',
];

// Sign-in, OAuth/SSO and checkout flows on any site: a path segment (or the
// first host label, e.g. login.example.com) such as /login, /oauth2/, /sso.
// The same pattern feeds a declarativeNetRequest regex, so it must stay RE2-safe
// and under DNR's 2KB compiled limit (anchoring on scheme + host exceeds it).
const PROTECTED_SEGMENT = '(?:oauth|openid|sso|saml|log-?[io]n|sign-?(?:in|on)|auth(?:orize|enticate)?|checkout|payments?)';
export const PROTECTED_URL_REGEX = `^[^?#]*/${PROTECTED_SEGMENT}2?(?:[/?#._-]|$)`;
const PROTECTED_URL_RE = new RegExp(PROTECTED_URL_REGEX, 'i');

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isProtectedUrl(url) {
  const parsed = typeof url === 'string' ? parseHttpUrl(url) : url;
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return PROTECTED_DOMAINS.some(d => hostMatches(host, d)) || PROTECTED_URL_RE.test(parsed.href);
}

function decodeKey(segment) {
  const raw = segment.split('=')[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isTrackingParam(key) {
  return TRACKING_PARAM_SET.has(key) || key.toLowerCase().startsWith('utm_');
}

/**
 * Returns `url` without tracking parameters. Works on the raw string so the
 * remaining parameters keep their exact encoding and order. Non-http(s),
 * invalid, sign-in and payment URLs come back unchanged.
 */
export function stripTrackingParams(url) {
  const parsed = typeof url === 'string' ? parseHttpUrl(url) : null;
  if (!parsed || isProtectedUrl(parsed)) return url;
  const hashAt = url.indexOf('#');
  const hash = hashAt < 0 ? '' : url.slice(hashAt);
  const base = hashAt < 0 ? url : url.slice(0, hashAt);
  const queryAt = base.indexOf('?');
  if (queryAt < 0) return url;
  const segments = base.slice(queryAt + 1).split('&');
  const kept = segments.filter(s => s && !isTrackingParam(decodeKey(s)));
  if (kept.length === segments.filter(Boolean).length) return url;
  const query = kept.length ? `?${kept.join('&')}` : '';
  return `${base.slice(0, queryAt)}${query}${hash}`;
}

// ————— Redirect unwrapping —————

const GOOGLE_HOST = '(?:www\\.)?google\\.[a-z]{2,3}(?:\\.[a-z]{2})?';

// Outbound-link wrappers: the real destination sits URL-encoded in a query
// parameter. `hostRe`/`pathRe` are RE2-safe source strings (also used by the
// DNR fallback rules); `params` are tried in order.
export const WRAPPERS = [
  { name: 'google', host: GOOGLE_HOST, path: '/url', params: ['q', 'url'] },
  { name: 'facebook', host: 'l(?:m)?\\.facebook\\.com', path: '/l\\.php', params: ['u'] },
  { name: 'instagram', host: 'l\\.instagram\\.com', path: '/', params: ['u'] },
  { name: 'youtube', host: '(?:www\\.|m\\.)?youtube\\.com', path: '/redirect', params: ['q'] },
  { name: 'reddit', host: 'out\\.reddit\\.com', path: '/[^?#]*', params: ['url'] },
  { name: 'steam', host: 'steamcommunity\\.com', path: '/linkfilter/?', params: ['u', 'url'] },
  { name: 'slack', host: 'slack-redir\\.net', path: '/link', params: ['url'] },
  { name: 'vk', host: 'away\\.vk\\.com', path: '/away\\.php', params: ['to'] },
  { name: 'linkedin', host: '(?:www\\.)?linkedin\\.com', path: '/redir/redirect/?', params: ['url'] },
  // Disqus appends ":<hash>" to the decoded target.
  { name: 'disqus', host: 'disq\\.us', path: '/url', params: ['url'], trailer: /:[\w-]{20,}$/ },
  // href.li puts the target, unencoded, as the whole query string.
  { name: 'hrefli', host: 'href\\.li', path: '/', wholeQuery: true },
];

const COMPILED = WRAPPERS.map(w => ({
  ...w,
  hostRe: new RegExp(`^${w.host}$`, 'i'),
  pathRe: new RegExp(`^${w.path}$`, 'i'),
}));

const MAX_DEPTH = 3; // a wrapper inside a wrapper (Google → Facebook → site)

function rawTarget(wrapper, url) {
  if (wrapper.wholeQuery) {
    const raw = url.search.slice(1);
    if (/^https?%3A/i.test(raw)) {
      try { return decodeURIComponent(raw); } catch { return null; }
    }
    return raw;
  }
  for (const name of wrapper.params) {
    const value = url.searchParams.get(name);
    if (value) return wrapper.trailer ? value.replace(wrapper.trailer, '') : value;
  }
  return null;
}

function unwrapOnce(url) {
  const wrapper = COMPILED.find(w => w.hostRe.test(url.hostname) && w.pathRe.test(url.pathname));
  if (!wrapper) return null;
  const target = rawTarget(wrapper, url);
  return target ? parseHttpUrl(target) : null;
}

/**
 * If `href` is a known tracking redirect, returns its destination (unwrapped
 * through nested wrappers, tracking parameters stripped). Otherwise null.
 * Only http(s) destinations are returned, so javascript:/data: never leak out.
 */
export function unwrapUrl(href) {
  let current = parseHttpUrl(href);
  if (!current) return null;
  let found = null;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const next = unwrapOnce(current);
    if (!next) break;
    found = next;
    current = next;
  }
  return found ? stripTrackingParams(found.href) : null;
}
