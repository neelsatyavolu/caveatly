# Caveatly — Chrome extension

Blocks ads and trackers on every site, turns on privacy protections Chrome leaves
off, and reads the fine print for you: scans the current site's Terms of Service
and Privacy Policy with Gemini and flags what matters in three tiers
(safe / caution / concern), graded A–F. UI implemented from the Caveatly
design-system project (`ui_kits/extension`).

Caveatly now includes what used to be two separate extensions, No Sponsored
(sponsored results on Google and Amazon) and Reuters Ad Blocker.

**Website:** https://caveatly.xanom.co ·
**Download:** [caveatly.zip](https://github.com/neelsatyavolu/caveatly/releases/latest/download/caveatly.zip) ·
**License:** [MIT](LICENSE)

## Install from a release

1. Download [`caveatly.zip`](https://github.com/neelsatyavolu/caveatly/releases/latest/download/caveatly.zip) and unzip it.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, pick the unzipped `caveatly/` folder.
3. Add your Gemini API key in Caveatly → **Settings** (free from [Google AI Studio](https://aistudio.google.com/apikey)).

## Build from source

```bash
npm install
npm run build        # bundles into dist/
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, pick `dist/`.
2. Click the Caveatly toolbar icon → **Settings** → paste your Gemini API key (`AIza…` from aistudio.google.com).
   The key is stored in `chrome.storage.local` only — never synced.
3. Visit any site, open the popup, and hit **Scan this page**. Optional: in Settings set **Auto-scan** so Caveatly scans when it finds terms/privacy on a domain you have not scanned yet (never when you only open the toolbar).

## How a scan works

1. `extract-page.js` is injected into the tab: finds Terms/Privacy links (or detects
   the page itself is a legal doc) and returns candidates.
2. `background.js` fetches up to two policy documents, converts HTML → text.
3. `groq.js` (OpenAI-compatible client) sends the text to Gemini which returns
   tiered flags with plain-English titles, explanations, clause refs, and verbatim quotes.
4. `report.js` computes the grade/stats deterministically from the flags; the report is
   cached per-origin and the badge shows the concern count.

## Ad blocking

- **Network blocking:** EasyList (ads) and EasyPrivacy (trackers) converted to
  `declarativeNetRequest` rulesets in `src/filters/`, so Chrome blocks requests itself.
  Plain `||domain^` filters are merged into shared `requestDomains` rules to stay far
  below Chrome's 30,000 guaranteed static rules.
- **Element hiding:** `src/adblock.js` runs in every frame and asks the service worker
  (`src/lib/adblock.js`) for EasyList's cosmetic filters, using Ghostery's engine
  (`src/filters/cosmetic.bin`). The worker injects the CSS with `origin: 'USER'`.
- **Sponsored results** (`src/content/sponsored.*`) on Google and Amazon search, and
  **Reuters** layout fixes plus a stub for its video player (`src/content/reuters*`).
- **Per-site pause** from the popup (one `allowAllRequests` dynamic rule), and a blocked
  count for the open tab.
- **More lists:** EasyList Cookie List (cookie notices, on by default) and Fanboy
  Annoyances (opt-in), each with its own ruleset and cosmetic engine.
- **Scriptlets** (`src/scriptlets/`, `src/lib/adblock-scriptlets.js`): uBO-style `+js(...)`
  filters from uBlock filters and quick-fixes, run in the page's MAIN world. This is what
  blocks YouTube video ads.
- **Sponsored results** on every Amazon storefront and Google search domain, plus Bing
  and DuckDuckGo (`src/lib/sponsored-matches.js`).
- **Right-click → Block element…** (`src/lib/custom-rules.js`, `src/content/picker*.js`):
  a picker that saves per-site hiding rules in `chrome.storage.local`.

Refresh the lists with `npm run filters` (downloads EasyList/EasyPrivacy, regenerates
`src/filters/`), review the diff, then `npm run build`. Lists only change when a new
version ships; the extension never downloads them itself.

## Privacy features (Settings)

- **Block non-essential cookies / dismiss consent banners** — `consent.js` clicks
  "necessary only" / "reject all" in common consent dialogs (best effort).
- **Send Global Privacy Control** — declarativeNetRequest rule adds `Sec-GPC: 1`.
- **Strip tracking parameters** — DNR rule removes ~100 click and campaign ids (`utm_*`,
  `gclid`, `fbclid`, …), never on sign-in or checkout URLs (`src/lib/link-rules.js`).
- **Skip tracking redirects** — `src/link-unwrap.js` rewrites `google.com/url`, `l.facebook.com`
  and similar wrapped links to their real destination before you open them.
- **Chrome privacy settings** (`src/lib/browser-privacy.js`, `privacy` permission) — Topics,
  Protected Audience and ad measurement off, WebRTC IP protection, no hyperlink-auditing
  pings; opt-in third-party cookie blocking and limits on what Chrome sends to Google.

## Privacy & analytics

Scanned policy text goes only to Gemini, with your key. Separately, `lib/heartbeat.js`
sends one anonymous ping per UTC day to `analytics.n3el.dev` (run by the developer):
a random install ID, the extension version, Chrome major version, CPU arch, and
whether it's a Web Store or unpacked install. No URLs, page content, keys or
personal data, and no cookies; only the country is kept, not the IP address. Uninstalls are counted
via `chrome.runtime.setUninstallURL`. Turn it off with **Settings → Share anonymous
usage stats**: nothing is sent and the uninstall URL is cleared. The website counts
page views with a cookieless script. Full details: https://caveatly.xanom.co/privacy

## Tests

```bash
npm run test:e2e     # loads the extension into Chromium, scans real sites
npm run test:heartbeat  # unit test: daily usage ping + opt-out (no network)
npm run test:adblock    # ad/tracker blocking, element hiding, pause, toggles (local server)
npm run test:adblock-lists     # cookie/annoyance lists, scriptlets, ad iframes, sponsored labels
npm run test:browser-privacy   # chrome.privacy prefs and ping blocking
npm run test:link-cleaning     # tracking params and redirect unwrapping (unit + e2e)
npm run test:custom-rules      # right-click picker and saved hiding rules
npm run test:scan-coverage     # scan pipeline on offline fixtures (add -- --live for real sites)
```

Visits github.com, stripe.com, and en.wikipedia.org; verifies extraction finds real
policy text (>2K chars), the LLM request is made, and all screens render. Uses a
local OpenAI-shaped mock by default; set `GEMINI_API_KEY` to run against real Gemini.
Screenshots land in `screenshots/`.

## Layout

- `src/components/` — design-system primitives (ported verbatim from the DS project)
- `src/screens/` — PopupHome, ReportPanel, SettingsPanel
- `src/lib/` — extraction, HTML→text, AI client, report builder, settings, ad blocking
- `src/filters/` — generated DNR rulesets and cosmetic engine (`npm run filters`)
- `src/content/` — site-specific content scripts (sponsored results, Reuters)
- `tools/build-filters.mjs` — filter list download and conversion
- `src/background.js` / `src/consent.js` — service worker & consent content script
- `src/styles/` — DS tokens (colors, type, spacing, effects)
- `site/` — static landing page, deployed on Vercel (project root: `site`)

## License

Caveatly's code is [MIT](LICENSE). Found a security issue? See [SECURITY.md](SECURITY.md).

The generated files in `src/filters/` come from [EasyList and EasyPrivacy](https://easylist.to/)
(GPLv3 or CC BY-SA 3.0), [Fanboy's lists](https://www.fanboy.co.nz/) (CC BY 3.0) and
[uBlock filters](https://github.com/uBlockOrigin/uAssets) (GPL-3.0), and keep those licences;
`src/filters/sources.json` records each source, licence and hash.

`src/filters/ubo-scriptlets.js` is uBlock Origin's scriptlet code (GPL-3.0), as packaged by
[ghostery/scriptlets](https://github.com/ghostery/scriptlets). Because it is bundled into the
extension, **the built extension as a whole is distributed under GPL-3.0**; Caveatly's own
source files remain MIT. Element hiding
uses [@ghostery/adblocker](https://github.com/ghostery/adblocker) (MPL-2.0). The filter
converter [@eyeo/abp2dnr](https://gitlab.com/eyeo/adblockplus/abc/abp2dnr) (GPL-3.0) is
a build-time tool only and is not shipped.
