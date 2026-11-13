// Custom element blocking, page side. Runs at document_start in every frame.
// 1. Remembers the element under the last right-click, so "Block element…"
//    can start the picker on it (the picker runs in this same isolated world).
// 2. If the user saved rules for this site, hides those elements right away
//    with a <style>, then asks the service worker to insert the same rules as
//    USER-origin CSS (which page styles cannot override) and drops the <style>
//    so the page is left with no visible trace of the extension.
(() => {
  if (globalThis.__caveatlyCustomRules) return;
  globalThis.__caveatlyCustomRules = true;

  document.addEventListener('contextmenu', event => {
    globalThis.__caveatlyContextTarget = event.target instanceof Element ? event.target : null;
  }, { capture: true, passive: true });

  // Rules belong to the site in the address bar; iframes find it from their ancestors.
  function topHostname() {
    const ancestors = location.ancestorOrigins;
    if (!ancestors || !ancestors.length) return location.hostname;
    try {
      return new URL(ancestors[ancestors.length - 1]).hostname;
    } catch {
      return location.hostname;
    }
  }

  function rulesFor(rules, hostname) {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    return rules.filter(r => r && typeof r.selector === 'string'
      && (host === r.site || host.endsWith(`.${r.site}`)));
  }

  function addStyle(selectors) {
    const style = document.createElement('style');
    style.textContent = selectors.map(s => `${s} { display: none !important; }`).join('\n');
    (document.head || document.documentElement).append(style);
    return style;
  }

  async function apply() {
    let stored;
    try {
      stored = await chrome.storage.local.get('customRules');
    } catch {
      return; // extension reloaded under this page: nothing to do
    }
    const rules = rulesFor(Array.isArray(stored.customRules) ? stored.customRules : [], topHostname());
    if (!rules.length) return;
    const style = addStyle(rules.map(r => r.selector));
    try {
      const res = await chrome.runtime.sendMessage({ type: 'customRules:apply' });
      if (res?.ok && res.applied > 0) style.remove(); // the USER stylesheet now does the job
    } catch {
      // Worker unavailable: keep the <style> so the elements stay hidden.
    }
  }

  apply();
})();
