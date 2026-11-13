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

Refresh the lists with `npm run filters` (downloads EasyList/EasyPrivacy, regenerates
`src/filters/`), review the diff, then `npm run build`. Lists only change when a new
version ships; the extension never downloads them itself.

## Privacy features (Settings)

- **Block non-essential cookies / dismiss consent banners** — `consent.js` clicks
  "necessary only" / "reject all" in common consent dialogs (best effort).
- **Send Global Privacy Control** — declarativeNetRequest rule adds `Sec-GPC: 1`.
- **Strip tracking parameters** — DNR rule removes `utm_*`, `gclid`, `fbclid`, etc.

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

The generated files in `src/filters/` come from [EasyList and EasyPrivacy](https://easylist.to/),
which are dual-licensed under GPLv3 and CC BY-SA 3.0 and keep that licence. Element hiding
uses [@ghostery/adblocker](https://github.com/ghostery/adblocker) (MPL-2.0). The filter
converter [@eyeo/abp2dnr](https://gitlab.com/eyeo/adblockplus/abc/abp2dnr) (GPL-3.0) is
a build-time tool only and is not shipped.
