// On-page scan: when terms of service / privacy policy signals appear on a domain
// that has not been scanned yet, either ask or auto-scan (pageScan: 'off' |
// 'ask' | 'auto'). Never tied to opening the toolbar popup. Skips origins
// already scanned or dismissed. Renders in a closed world via shadow DOM.
(async () => {
  if (window.top !== window) return;

  const { pageScan } = await chrome.storage.sync.get({ pageScan: 'ask' });
  if (pageScan === 'off') return;

  const origin = location.origin;
  const promptKey = `prompt:${origin}`;

  const local = await chrome.storage.local.get(['apiKeys', 'apiKey', promptKey]);
  const keys = local.apiKeys || {};
  const hasKey = Boolean(keys.gemini || local.apiKey);
  if (!hasKey) return;

  // Already handled this origin — don't re-toast (session or durable).
  if (sessionStorage.getItem('__fineprint_prompted')) return;
  if (local[promptKey] === 'dismissed') return;
  const { report: cached } = await chrome.runtime.sendMessage({ type: 'getCached', origin }).catch(() => ({ report: null }));
  if (cached) return;

  // High-signal pages only: an actual legal document, a signup/checkout URL,
  // binding-agreement language ("By continuing you agree to…"), an "I agree to
  // the terms" checkbox, or a password form mentioning terms (guards logins).
  const LEGAL = /(terms|privacy|polic(?:y|ies)|legal|eula|agreement)/i;
  const SIGNUP_URL = /sign.?up|register|join\b|checkout|create.?account|subscribe/i;
  const AGREE = /\b(agree|agreeing|consent) (to|with)\b|terms of (service|use)|privacy policy/i;
  const BINDING = /\bby (proceeding|continuing|clicking|tapping|signing.?(?:up|in)|creating an account|registering|subscribing|submitting|placing an order|using)\b[\s\S]{0,100}?\b(agree|accept|consent)|\b(?:i|you) (?:agree|accept|consent) to (?:our|the|these)\b|\b(?:agree|agreeing) to (?:our|the) (?:terms|privacy|conditions)/i;

  // Binding language, excluding cookie-banner phrasing ("by clicking accept you
  // agree to our use of cookies") — the consent handler owns those.
  const bindingAgreement = () => {
    const text = (document.body.innerText || '').slice(0, 40000);
    const rx = new RegExp(BINDING.source, 'gi');
    let m;
    while ((m = rx.exec(text))) {
      const ctx = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 140);
      if (!/cookie/i.test(ctx)) return true;
    }
    return false;
  };

  const agreeCheckbox = () => {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')].slice(0, 50);
    for (const cb of boxes) {
      const label = cb.closest('label') || (cb.id && document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)) || cb.parentElement;
      const text = ((label && label.textContent) || '').slice(0, 250);
      if (/cookie/i.test(text)) continue;
      if (/(terms|privacy|conditions)/i.test(text) && /(agree|accept|consent)/i.test(text)) return true;
    }
    return false;
  };

  const triggered = () => {
    if (LEGAL.test(document.title) || LEGAL.test(location.pathname)) return true;
    if (SIGNUP_URL.test(location.href)) return true;
    if (bindingAgreement() || agreeCheckbox()) return true;
    const pw = document.querySelector('input[type="password"], input[autocomplete="new-password"]');
    return Boolean(pw) && AGREE.test((document.body.innerText || '').slice(0, 30000));
  };

  // SPAs render forms (and change URLs) well after document_idle — poll briefly,
  // then keep a debounced mutation watch so signup modals opened later still count.
  let hit = triggered();
  for (let i = 0; !hit && i < 12; i += 1) {
    await new Promise(r => setTimeout(r, 1000));
    hit = triggered();
  }
  if (!hit) {
    hit = await new Promise(resolve => {
      let timer = null;
      let lastCheck = 0;
      const done = result => { observer.disconnect(); clearTimeout(timer); clearTimeout(deadline); resolve(result); };
      const observer = new MutationObserver(() => {
        if (Date.now() - lastCheck < 1000) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          lastCheck = Date.now();
          if (triggered()) done(true);
        }, 600);
      });
      const deadline = setTimeout(() => done(false), 180000);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
  if (!hit) return;

  // Re-check cache after wait — user may have scanned from the toolbar.
  const { report: cachedNow } = await chrome.runtime.sendMessage({ type: 'getCached', origin }).catch(() => ({ report: null }));
  if (cachedNow) return;

  sessionStorage.setItem('__fineprint_prompted', '1');

  // ————— Toast UI (shadow DOM) —————
  const host = document.createElement('div');
  host.id = 'fineprint-prompt';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .card { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: 320px;
        background: #fbf9f4; border: 1px solid #ded8cc; border-radius: 13px;
        box-shadow: 0 12px 32px rgba(32,30,34,0.14), 0 4px 10px rgba(32,30,34,0.06);
        font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif; color: #2f2c31;
        padding: 14px; animation: fp-pop 200ms cubic-bezier(0.22,0.61,0.36,1); }
      @keyframes fp-pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      .row { display: flex; align-items: flex-start; gap: 10px; }
      .mark { width: 26px; height: 26px; border-radius: 7px; background: #12735f; color: #fff; flex: 0 0 auto;
        display: flex; align-items: center; justify-content: center; font-family: Georgia, serif; font-weight: 600; font-size: 16px; }
      .title { font-family: Georgia, 'Times New Roman', serif; font-size: 16px; color: #17161a; line-height: 1.3; }
      .sub { font-size: 12.5px; color: #78736b; margin-top: 2px; line-height: 1.45; }
      .actions { display: flex; gap: 8px; margin-top: 11px; }
      button { font-family: inherit; font-weight: 600; font-size: 13px; cursor: pointer; border-radius: 9px; line-height: 1; }
      .scan { background: #12735f; color: #fff; border: none; padding: 9px 14px; }
      .scan:hover { background: #0e5c4c; }
      .later { background: transparent; color: #5c5852; border: 1px solid #ded8cc; padding: 9px 12px; }
      .later:hover { background: #f1ede4; }
      .close { position: absolute; top: 8px; right: 10px; background: none; border: none; color: #9d978c; font-size: 15px; padding: 4px; }
      .bar { height: 5px; background: #f1ede4; border-radius: 999px; overflow: hidden; margin-top: 12px; }
      .fill { height: 100%; width: 40%; background: #12735f; border-radius: 999px; animation: fp-sweep 1.2s ease-in-out infinite alternate; }
      @keyframes fp-sweep { from { margin-left: 0; width: 15%; } to { margin-left: 60%; width: 40%; } }
      .grade { width: 40px; height: 40px; flex: 0 0 auto; border-radius: 9px; border: 2px solid; display: flex;
        align-items: center; justify-content: center; font-family: Georgia, serif; font-weight: 600; font-size: 22px; background: #fff; }
      .hidden { display: none; }
    </style>
    <div class="card" role="dialog" aria-label="Fineprint">
      <button class="close" aria-label="Dismiss">✕</button>
      <div class="row" id="ask">
        <span class="mark">F</span>
        <div>
          <div class="title" id="ask-title">Read this site's fine print?</div>
          <div class="sub">Terms &amp; privacy policy, summarized in seconds.</div>
          <div class="actions"><button class="scan">Scan now</button><button class="later">Not now</button></div>
        </div>
      </div>
      <div class="row hidden" id="busy">
        <span class="mark">F</span>
        <div style="flex:1">
          <div class="title">Reading the fine print…</div>
          <div class="bar"><div class="fill"></div></div>
        </div>
      </div>
      <div class="row hidden" id="done">
        <span class="grade" id="grade"></span>
        <div>
          <div class="title" id="headline"></div>
          <div class="sub" id="detail"></div>
        </div>
      </div>
    </div>`;

  const el = id => shadow.getElementById(id);
  const show = id => { for (const s of ['ask', 'busy', 'done']) el(s).classList.toggle('hidden', s !== id); };
  const markDismissed = () => chrome.storage.local.set({ [promptKey]: 'dismissed' });
  const dismiss = () => { markDismissed(); host.remove(); };
  shadow.querySelector('.close').addEventListener('click', dismiss);
  shadow.querySelector('.later').addEventListener('click', dismiss);

  async function doScan() {
    show('busy');
    const resp = await chrome.runtime.sendMessage({ type: 'scanFromPage' }).catch(() => null);
    if (resp?.ok) {
      // Background opens the full report UI; drop the toast so it isn't stacked under it.
      host.remove();
      return;
    }
    el('headline').textContent = "Couldn't scan this page.";
    el('grade').textContent = '–';
    el('grade').style.color = el('grade').style.borderColor = '#9d978c';
    el('detail').textContent = resp?.message || 'Open the Fineprint popup to try again.';
    show('done');
    setTimeout(() => host.remove(), 8000);
  }

  shadow.querySelector('.scan').addEventListener('click', doScan);
  document.documentElement.appendChild(host);

  if (pageScan === 'auto') doScan();
  else show('ask');
})();
