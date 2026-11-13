// Convert fetched HTML into readable text. Runs in the MV3 service worker,
// where DOMParser is unavailable, so this is a conservative tag-stripper.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
  mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', sect: '§', euro: '€', middot: '·',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ntilde: 'ñ',
  aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ocirc: 'ô', icirc: 'î', ucirc: 'û',
  Eacute: 'É', iexcl: '¡', iquest: '¿',
};
// A <main>/<article> with at least this much text is the document; anything
// smaller is probably a teaser, so the whole body is used instead.
const MIN_MAIN_CHARS = 2000;

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch { return ' '; }
}

function stripToText(html) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|aside|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/dd|\/dt|\/table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Outer region of the first <main> (or <article>) up to its last closing tag.
function mainRegion(html) {
  for (const tag of ['main', 'article']) {
    const start = html.search(new RegExp(`<${tag}\\b`, 'i'));
    const end = html.toLowerCase().lastIndexOf(`</${tag}>`);
    if (start >= 0 && end > start) return html.slice(start, end);
  }
  return null;
}

export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  const region = mainRegion(html);
  if (region) {
    const text = stripToText(region);
    if (text.length >= MIN_MAIN_CHARS) return text;
  }
  return stripToText(html);
}
