// Best-effort cookie-consent handler. When enabled in settings, watches for a
// consent banner and clicks the most privacy-preserving option it can find
// ("necessary only" / "reject all"). Reports what it did to the background.
import { consentChoice } from './lib/consent-labels.js';

export function isBannerVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  // position:fixed banners have a null offsetParent, so size is the check.
  return rect.width >= 8 && rect.height >= 8;
}

export function buttonsIn(root) {
  const buttonSel = 'button, [role="button"], input[type="button"], input[type="submit"], a';
  const out = [...root.querySelectorAll(buttonSel)];
  // CMPs such as Usercentrics render their buttons inside an open shadow root.
  const shadows = [];
  if (root.shadowRoot) shadows.push(root.shadowRoot);
  for (const child of root.children) {
    if (child.shadowRoot) shadows.push(child.shadowRoot);
  }
  for (const sr of shadows) out.push(...sr.querySelectorAll(buttonSel));
  return out;
}

if (typeof document !== 'undefined') {
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

  const CONTAINER_SEL = [
    '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#usercentrics-root', '#truste-consent-track',
    '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]', '[role="dialog"]', '[role="alertdialog"]',
  ].join(',');

  let done = false;

  function labelOf(el) {
    return ((el.textContent || el.value || '') + ' ' + (el.getAttribute('aria-label') || ''))
      .trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function tryHandle() {
    if (done) return false;
    for (const container of document.querySelectorAll(CONTAINER_SEL)) {
      const shadowButtons = container.shadowRoot ? buttonsIn(container).some(btn => btn.getClientRects().length > 0) : false;
      if (!isBannerVisible(container) && !shadowButtons) continue;
      let fallback = null;
      for (const btn of buttonsIn(container)) {
        if (!btn.getClientRects().length) continue;
        const choice = consentChoice(labelOf(btn));
        if (!choice) continue;
        if (settings.block && choice === 'necessary-only') return click(btn, 'necessary-only');
        if (settings.autoReject && choice === 'rejected') fallback = fallback || btn;
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
}
