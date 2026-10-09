// Button-label matchers for the cookie-consent handler. Anchored so a label
// like "Accept all" cannot match just because nearby words say "necessary",
// and "Reject all cookies" (a very common CMP label) is recognized.

const NECESSARY = /^(?:only\s+(?:strictly\s+)?(?:necessary|essential)(?:\s+cookies)?|use\s+(?:strictly\s+)?(?:necessary|essential)(?:\s+cookies)?(?:\s+only)?|(?:necessary|essential)(?:\s+cookies)?\s+only|strictly\s+necessary(?:\s+cookies)?|(?:accept|allow)\s+only\s+(?:strictly\s+)?(?:necessary|essential)(?:\s+cookies)?)\.?$/i;

const REJECT = /^(?:reject|decline|refuse|deny)(?:\s+(?:all|optional|non-?essential))?(?:\s+cookies)?\.?$|^continue without (?:accepting|agreeing)(?:\s+cookies)?\.?$/i;

/** 'necessary-only' | 'rejected' | null for a single button label. */
export function consentChoice(label) {
  const text = String(label || '').trim().replace(/\s+/g, ' ');
  if (!text || text.length > 60) return null;
  if (NECESSARY.test(text)) return 'necessary-only';
  if (REJECT.test(text)) return 'rejected';
  return null;
}
