# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's private reporting: **Security → Report a vulnerability** on this
repository. You'll get a response within a few days.

## What Caveatly handles

- Your Gemini API key is stored in `chrome.storage.local` and is only sent to
  `generativelanguage.googleapis.com`.
- Scanned Terms/Privacy text is sent only to Gemini. The only other request is
  an anonymous daily usage ping to `analytics.n3el.dev` (random install ID,
  versions, CPU arch), which can be turned off in Settings.

Never commit API keys. Local secrets belong in `.env`, which is gitignored.
