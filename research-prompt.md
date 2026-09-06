# Research task: free LLM API providers for a ToS-summarizing browser extension

I'm building a Chrome extension that sends extracted terms-of-service / privacy-policy
text to an LLM API and gets back a JSON list of flagged clauses. I need the best
provider options meeting ALL hard requirements below. Current baseline to beat:
**Google Gemini 3.5 Flash-Lite free tier** (1M-token context, ~15 RPM / ~250K TPM /
~1,000 req/day, ~2s latency for my workload).

## Hard requirements (disqualify anything that fails one)

1. **Permanently free tier** — not one-time trial credits, not "first $X free".
   Note if a credit card or phone number is required at signup.
2. **Single-request input of at least 16,000 tokens** (my requests are 10–14K input
   + ~1K output). CRITICAL: check the *effective* per-request ceiling, not just the
   context window — some providers (e.g. Groq free: 6–8K TPM) reject any request
   larger than their per-minute token bucket with a 413. Report the effective max
   request size explicitly.
3. **Rate limits of at least 5 requests/min and 100 requests/day** at ~15K tokens
   per request. Check the daily *token* cap too (e.g. 200K tokens/day = only ~13 of
   my requests — fails).
4. **OpenAI-compatible chat-completions endpoint** (Bearer auth, `/chat/completions`)
   with JSON mode (`response_format: {type: "json_object"}`) or structured outputs.
   User-supplied API key (BYOK); no OAuth-only access.
5. **Latency ≤ 3 seconds** for ~12K tokens in / ~1K out (time-to-last-token).
6. **Model quality ≥ Llama-3.1-8B class** for reading legal text; prefer 20B+ or
   equivalent.

## Report, per candidate

- Provider + exact model ID + endpoint base URL
- Free-tier RPM / TPM / RPD / daily-token cap
- Effective max tokens per single request
- Context window
- JSON-mode support
- Reported latency / throughput
- Whether free-tier prompts are used for training
- Model deprecation risk (stable ID? recent retirements?)
- Signup friction (card / phone required?)

Cite sources with dates — **prefer official rate-limit docs and sources under
3 months old**. Where third-party numbers conflict, say so rather than picking one.

Candidates worth checking: Cerebras, SambaNova, Mistral (La Plateforme), OpenRouter
free models, Cloudflare Workers AI, Together, DeepInfra, Hyperbolic, GitHub Models,
NVIDIA NIM, Scaleway, OVH AI Endpoints — plus anything newer.

## Output

A comparison table of everything that passes, a "disqualified + why" list, and a
ranked top 3 with a one-paragraph recommendation: does anything beat Gemini 3.5
Flash-Lite free on speed while meeting the input-size requirement?
