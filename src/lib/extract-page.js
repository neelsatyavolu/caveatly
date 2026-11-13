// Injected into the page via chrome.scripting.executeScript({ func, args }).
// MUST stay self-contained: executeScript serializes the function, so it cannot
// reference anything outside its own body. The word lists live in
// lib/legal-links.js and arrive as regex sources in `opts`; this function only
// gathers links, and the service worker decides which ones are policies.
export async function extractLegalSources(opts) {
  const linkRx = new RegExp(opts.linkSource, 'iu');
  const hrefRx = new RegExp(opts.hrefSource, 'i');
  const privacyRx = new RegExp(opts.privacySource, 'iu');
  const termsRx = new RegExp(opts.termsSource, 'iu');
  const MAX_LINKS = 400;
  const FOOTER = 'footer, [role="contentinfo"], [id*="footer" i], [class*="footer" i]';

  // Links can sit inside open shadow roots (web-component footers), which
  // document.querySelectorAll does not reach.
  const roots = () => {
    const out = [document];
    for (let i = 0; i < out.length && out.length < 200; i++) {
      for (const el of out[i].querySelectorAll('*')) {
        if (el.shadowRoot) out.push(el.shadowRoot);
      }
    }
    return out;
  };

  const collect = () => {
    const links = [];
    const seen = new Set();
    for (const root of roots()) {
      for (const a of root.querySelectorAll('a[href]')) {
        const href = a.href;
        if (typeof href !== 'string' || !/^https?:/i.test(href)) continue;
        const text = (a.textContent || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        let path = '';
        try { const u = new URL(href); path = decodeURIComponent(u.pathname + u.search); } catch { continue; }
        if (!linkRx.test(text) && !hrefRx.test(path)) continue;
        const key = `${href}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ text, href, inFooter: Boolean(a.closest(FOOTER)) });
        if (links.length >= MAX_LINKS) return links;
      }
    }
    return links;
  };

  const hasBoth = links => links.some(l => privacyRx.test(l.text)) && links.some(l => termsRx.test(l.text));

  // Footers on single-page apps render after load (TikTok, Airbnb, Spotify):
  // poll for a short while before settling for what is there.
  let links = collect();
  const deadline = Date.now() + (opts.waitMs || 0);
  while (!hasBoth(links) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400));
    links = collect();
  }

  const title = document.title || '';
  const looksLegal = privacyRx.test(title) || termsRx.test(title) || hrefRx.test(location.pathname);
  // Prefer the main content over the whole body so menus and footers stay out.
  const mainText = () => {
    const main = document.querySelector('main, article, [role="main"]');
    const text = main ? main.innerText || '' : '';
    return text.length >= 2000 ? text : (document.body ? document.body.innerText || '' : '');
  };
  return {
    url: location.href,
    origin: location.origin,
    hostname: location.hostname.replace(/^www\./, ''),
    title,
    contentType: document.contentType || '',
    looksLegal,
    pageText: looksLegal ? mainText().slice(0, opts.maxPageChars || 400000) : null,
    links,
  };
}
