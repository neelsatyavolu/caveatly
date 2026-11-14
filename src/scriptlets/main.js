// Runs uBO scriptlets (`##+js(...)` filters) in the page's MAIN world.
// lib/adblock.js registers one bundle per filter list as a document_start
// content script matched to the hostnames that list has scriptlets for, so they
// run before any page script and are not subject to the page's CSP (unlike an
// inline <script>). The scriptlet code is uBlock Origin's (GPL-3.0), vendored by
// tools/build-filters.mjs into filters/ubo-scriptlets.js.
import { run } from '../filters/ubo-scriptlets.js';
import { callsForHost } from '../lib/scriptlet-match.js';

// about:blank and srcdoc frames have no hostname of their own; they inherit
// the origin of the page that made them (matchOriginAsFallback).
function currentHostname() {
  if (location.hostname) return location.hostname;
  try { return new URL(self.origin).hostname; } catch { return ''; }
}

export function start(data) {
  try {
    const calls = callsForHost(data, currentHostname());
    // No extension resources are web-accessible, so scriptlets that would
    // redirect to one (warOrigin) do nothing instead.
    if (calls.length) run({}, calls);
  } catch (err) {
    console.error('[caveatly] scriptlets failed', err);
  }
}
