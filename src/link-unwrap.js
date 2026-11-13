// Skips tracking redirects: when a link that goes through google.com/url,
// l.facebook.com, out.reddit.com, ... is about to be used (pressed, clicked,
// middle-clicked, opened with Enter, right-clicked to copy, hovered or
// focused), its href is swapped for the decoded destination. Registered by
// lib/link-cleaning.js only while "unwrapLinks" is on. Event-driven on purpose:
// no DOM scanning, so it costs nothing on pages without wrapped links.
import { unwrapUrl } from './lib/link-rules.js';

const EVENTS = ['pointerdown', 'mousedown', 'auxclick', 'click', 'contextmenu', 'mouseover', 'focusin'];

function anchorFrom(event) {
  // composedPath reaches links inside open shadow roots too.
  for (const node of event.composedPath()) {
    if ((node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) && node.href) return node;
  }
  return null;
}

function wrappedPing(anchor) {
  const ping = anchor.getAttribute('ping');
  if (!ping) return false;
  try {
    return ping.split(/\s+/).some(p => unwrapUrl(new URL(p, document.baseURI).href));
  } catch {
    return false;
  }
}

function cleanAnchor(anchor) {
  const target = unwrapUrl(anchor.href);
  if (target) anchor.setAttribute('href', target);
  if (target || wrappedPing(anchor)) {
    // Google search reports the click through a ping to /url and, for links
    // marked data-jsarwt, re-wraps the href on mousedown. Drop both.
    anchor.removeAttribute('ping');
    anchor.removeAttribute('data-jsarwt');
  }
}

function onEvent(event) {
  const anchor = anchorFrom(event);
  if (anchor) cleanAnchor(anchor);
}

for (const type of EVENTS) window.addEventListener(type, onEvent, { capture: true, passive: true });
window.addEventListener('keydown', event => {
  if (event.key === 'Enter') onEvent(event);
}, { capture: true, passive: true });
