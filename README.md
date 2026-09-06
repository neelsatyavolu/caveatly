# Fineprint — Chrome extension

Reads the fine print for you: scans the current site's Terms of Service and
Privacy Policy with Gemini and flags what matters in three tiers
(safe / caution / concern), graded A–F. UI implemented from the Fineprint
design-system project (`ui_kits/extension`).

## Install & run

```bash
npm install
npm run build        # bundles into dist/
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, pick `dist/`.
2. Click the Fineprint toolbar icon → **Settings** → paste your Gemini API key (`AIza…` from aistudio.google.com).
   The key is stored in `chrome.storage.local` only — never synced.
3. Visit any site, open the popup, and hit **Scan this page**. Optional: in Settings set **Auto-scan** so Fineprint scans when it finds terms/privacy on a domain you have not scanned yet (never when you only open the toolbar).

## How a scan works

1. `extract-page.js` is injected into the tab: finds Terms/Privacy links (or detects
   the page itself is a legal doc) and returns candidates.
2. `background.js` fetches up to two policy documents, converts HTML → text.
3. `groq.js` (OpenAI-compatible client) sends the text to Gemini which returns
   tiered flags with plain-English titles, explanations, clause refs, and verbatim quotes.
4. `report.js` computes the grade/stats deterministically from the flags; the report is
   cached per-origin and the badge shows the concern count.

## Privacy features (Settings)

- **Block non-essential cookies / dismiss consent banners** — `consent.js` clicks
  "necessary only" / "reject all" in common consent dialogs (best effort).
- **Send Global Privacy Control** — declarativeNetRequest rule adds `Sec-GPC: 1`.
- **Strip tracking parameters** — DNR rule removes `utm_*`, `gclid`, `fbclid`, etc.

## Tests

```bash
npm run test:e2e     # loads the extension into Chromium, scans real sites
```

Visits github.com, stripe.com, and en.wikipedia.org; verifies extraction finds real
policy text (>2K chars), the LLM request is made, and all screens render. Uses a
local OpenAI-shaped mock by default; set `GEMINI_API_KEY` to run against real Gemini.
Screenshots land in `screenshots/`.

## Layout

- `src/components/` — design-system primitives (ported verbatim from the DS project)
- `src/screens/` — PopupHome, ReportPanel, SettingsPanel
- `src/lib/` — extraction, HTML→text, AI client, report builder, settings
- `src/background.js` / `src/consent.js` — service worker & consent content script
- `src/styles/` — DS tokens (colors, type, spacing, effects)
