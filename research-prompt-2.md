# Follow-up: narrow to 3 pinned candidates

Good analysis. Now narrow to **exactly 3 (provider, model) pairs** — one primary, one
failover, one alternate — with every field pinned so I can paste them straight into
config. No families, no "e.g.", no "various". Requirements:

1. **Commit to ONE exact model ID per provider.** For NVIDIA NIM, pick the single
   best model for turning 10–14K tokens of legal text into structured JSON given
   *free-tier* latency (choose among llama-3.3-70b-instruct, nemotron-super-49b,
   deepseek-v4-flash, or better — and defend the pick in ≤2 sentences). For Mistral,
   name the alias AND the pinned version it currently resolves to. For Gemini,
   confirm the current stable Flash-Lite ID.
2. **Verify JSON mode for that exact model** on the OpenAI-compatible endpoint — if
   the field syntax differs from `response_format: {"type": "json_object"}`
   (e.g. NIM's `nvext`/`guided_json`), show the exact request fragment.
3. **Resolve your own caveats with evidence, not hedging**: (a) NIM free-tier
   latency on ~12K-token prompts — find benchmarks or user reports from 2026; if
   none exist, say "no data" explicitly. (b) Mistral Experiment-tier actual
   RPM/TPM/monthly caps as currently documented — if only visible in the console,
   say so and give the most recent reported numbers with dates.
4. **Final output = one table**, columns: rank | provider | exact model ID |
   endpoint base URL | effective max request tokens | free RPM / RPD /
   daily-or-monthly tokens | JSON-mode syntax | expected latency (12K in / 1K out) |
   trains on prompts? | one-line reason for its slot.
5. **End with a one-paragraph verdict**: the single best failover behind Gemini 3.5
   Flash-Lite, and the tie-breaker that decided it.

Constraints unchanged: permanent free, ≥16K effective tokens per request, ≥5 RPM and
≥100 req/day at ~15K tokens each, OpenAI-compatible with BYOK. **Drop the OpenRouter
$10-unlock option — paid unlocks are out of scope.** Prefer sources under 3 months
old; where a number is console-only, mark it `[console-verify]` rather than guessing.
