# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's private reporting: **Security → Report a vulnerability** on this
repository. You'll get a response within a few days.

## What Caveatly handles

- Your Gemini API key is stored in `chrome.storage.local` and is only sent to
  `generativelanguage.googleapis.com`.
- The only data sent off-device is the text of the Terms/Privacy documents
  being scanned. There is no Caveatly server.

Never commit API keys. Local secrets belong in `.env`, which is gitignored.
