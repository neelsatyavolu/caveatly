// Best-effort cookie-consent handler. When enabled in settings, watches for a
// consent banner and clicks the most privacy-preserving option it can find
// ("necessary only" / "reject all"). Reports what it did to the background.
(async () => {
  const settings = await chrome.storage.sync.get({ block: true, autoReject: true });
  if (!settings.block && !settings.autoReject) return;

  // Some sites reload after a consent click without persisting the choice —
  // cap attempts per tab (sessionStorage survives reloads) to break the loop.
  const ATTEMPTS_KEY = '__caveatly_consent_attempts';
  const priorAttempts = Number(sessionStorage.getItem(ATTEMPTS_KEY) || 0);
  if (priorAttempts >= 2) return;

  // If a CMP has already recorded a choice, leave the page alone — clicking the
  // (still-present) preference-center buttons re-triggers apply-and-reload loops.
  if (/OptanonAlertBoxClosed|CookieConsent=|euconsent-v2|cookieyes-consent/.test(document.cookie)) return;

  const NECESSARY = /\b(only necessary|necessary only|essential only|only essential|use necessary|necessary cookies only|strictly necessary)\b/i;
  const REJECT = /^(reject|decline|refuse|deny)(\s+(all|optional|non.?essential))?\.?$|^(reject|decline)\s+cookies$|continue without (accepting|agreeing)/i;
  const CONTAINER_SEL = [
    '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#usercentrics-root', '#truste-consent-track',
    '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]', '[role="dialog"]', '[role="alertdialog"]',
  ].join(',');

  let done = false;

  function buttonsIn(root) {
    return root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a');
  }

  function labelOf(el) {
    return ((el.textContent || el.value || '') + ' ' + (el.getAttribute('aria-label') || ''))
      .trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function tryHandle() {
    if (done) return false;
    for (const container of document.querySelectorAll(CONTAINER_SEL)) {
      if (!(container instanceof HTMLElement) || !container.offsetParent) continue;
      let fallback = null;
      for (const btn of buttonsIn(container)) {
        const label = labelOf(btn);
        if (!label || label.length > 60) continue;
        if (settings.block && NECESSARY.test(label)) return click(btn, 'necessary-only');
        if (settings.autoReject && REJECT.test(label)) fallback = fallback || btn;
      }
      if (fallback) return click(fallback, 'rejected');
    }
    return false;
  }

  function click(btn, action) {
    done = true;
    sessionStorage.setItem(ATTEMPTS_KEY, String(priorAttempts + 1));
    btn.click();
    chrome.runtime.sendMessage({ type: 'consentResult', action }).catch(() => {});
    return true;
  }

  // Banners often mount late; poll briefly instead of observing everything.
  if (tryHandle()) return;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (tryHandle() || attempts >= 16) clearInterval(timer);
  }, 500);
})();
