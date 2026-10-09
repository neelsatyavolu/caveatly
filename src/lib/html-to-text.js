// Convert fetched HTML into readable text. Runs in the MV3 service worker,
// where DOMParser is unavailable, so this is a conservative tag-stripper.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', copy: '©', sect: '§',
};

function fromEntityCode(n) {
  // Invalid numeric entities used to throw RangeError and discard the whole document.
  if (!Number.isInteger(n) || n < 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return null;
  return String.fromCodePoint(n);
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (m, n) => fromEntityCode(Number(n)) ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => fromEntityCode(parseInt(n, 16)) ?? m)
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
