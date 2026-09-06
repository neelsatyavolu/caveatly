// OpenAI-compatible chat-completions client for legal-text analysis (Gemini).
// apiBase/model can be overridden via chrome.storage.local (e2e mock server).
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const MAX_INPUT_CHARS = 200000;
const MIN_INPUT_CHARS = 6000;
const MAX_OUTPUT_TOKENS = 1024;
const PROMPT_OVERHEAD_TOKENS = 800; // system prompt + message framing
const CHARS_PER_TOKEN = 3.5;
const VALID_TIERS = new Set(['safe', 'caution', 'concern']);

// Some hosts reject oversize requests (413). Once we learn a working budget,
// keep it for the service worker's lifetime.
const learnedBudgets = new Map();

const SYSTEM_PROMPT = `You are Fineprint, an assistant that reads terms-of-service and privacy-policy text and explains what matters to an everyday reader with no legal background.
Respond ONLY with JSON in this exact shape:
{"flags":[{"tier":"safe|caution|concern","title":"...","explanation":"...","clauseRef":"...","topic":"...","quote":"..."}]}
Rules:
- 4 to 8 flags total, most important first. Prefer fewer high-signal flags — do not pad with routine cautions just to hit a count.
- title: a short, plain sentence about what the company can do to the reader, max 60 characters. Good: "They can use your posts in ads", "They keep your content after you delete your account", "You can't take them to court". Bad: "Broad perpetual content license", "Unilateral termination". NEVER use legal jargon (unilateral, perpetual, irrevocable, indemnify, arbitration) in a title — say what it means instead.
- explanation: ONE plain sentence, max 140 characters, describing the practical effect on the reader. Assume they've never read a contract.
- CALIBRATION — grade against what is normal, not against perfection. Reserve "concern" for practices that go BEYOND industry norm and can genuinely hurt someone: selling personal data, keeping or using content after account deletion, training AI on private content without opt-out, taking away all legal recourse, charging money without clear consent. Industry-standard practices are "caution": arbitration/class-action clauses, right to change terms, the ordinary content license a service needs to operate, tracking cookies, suspending rule-breakers. "safe" = genuinely user-friendly commitments (easy deletion, clear opt-outs, limited data use, strong security promises).
- DIFFERENTIATE sites: a privacy-respecting org may be mostly safe + a few cautions (0 concerns). A typical mainstream SaaS is ~0–1 concern + several cautions. Data-heavy / ad-driven / lock-in-heavy policies should earn multiple concerns. Do not score every mainstream ToS the same.
- clauseRef: section number or heading if identifiable (e.g. "§4.2 Data Sharing"), else the document name.
- topic: one word like Tracking, Retention, Licensing, Legal, Cookies, Security, Account, Billing.
- quote: short verbatim excerpt supporting the flag, max 150 characters. Omit if none.
- Only include flags actually supported by the provided text.`;

export class GroqError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function extractJson(content) {
  const trimmed = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // reasoning models may prefix thinking
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new GroqError('Model returned unparseable JSON', 'bad-json');
}

function sanitizeFlags(raw) {
  if (!raw || !Array.isArray(raw.flags)) throw new GroqError('Model response missing flags array', 'bad-shape');
  const flags = raw.flags
    .filter(f => f && VALID_TIERS.has(f.tier) && typeof f.title === 'string' && f.title.trim())
    .map(f => ({
      tier: f.tier,
      title: String(f.title).trim().slice(0, 90),
      explanation: f.explanation ? String(f.explanation).trim().slice(0, 220) : undefined,
      clauseRef: f.clauseRef ? String(f.clauseRef).trim().slice(0, 60) : undefined,
      topic: f.topic ? String(f.topic).trim().slice(0, 24) : undefined,
      quote: f.quote ? String(f.quote).trim().slice(0, 240) : undefined,
    }))
    .slice(0, 16);
  if (!flags.length) throw new GroqError('Model returned no usable flags', 'no-flags');
  return flags;
}

function buildUserMessage(site, docs, charBudget) {
  let budget = charBudget;
  const sections = [];
  for (const doc of docs) {
    if (budget <= 500) break;
    const text = doc.text.slice(0, budget);
    budget -= text.length;
    sections.push(`## ${doc.label} (${doc.url || site})\n${text}`);
  }
  return `Site: ${site}\n\n${sections.join('\n\n')}`;
}

// A 413 body reads "…on tokens per minute (TPM): Limit 6000, Requested 13093…".
// Derive the input budget that fits under that limit.
function budgetFromLimit(body, outputTokens) {
  const limit = Number((body.match(/Limit (\d+)/) || [])[1]);
  if (!limit) return null;
  const inputTokens = limit - PROMPT_OVERHEAD_TOKENS - outputTokens;
  if (inputTokens < 1000) return null;
  return Math.max(MIN_INPUT_CHARS, Math.floor(inputTokens * CHARS_PER_TOKEN));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function analyzeLegalDocs({ apiKey, apiBase, model, maxInputChars, maxOutputTokens, site, docs }) {
  if (!apiKey) throw new GroqError('No API key configured', 'no-key');

  const outputTokens = maxOutputTokens || MAX_OUTPUT_TOKENS;
  const budgetKey = `${apiBase || DEFAULT_BASE}|${model || DEFAULT_MODEL}`;
  let charBudget = learnedBudgets.get(budgetKey) || maxInputChars || MAX_INPUT_CHARS;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`${apiBase || DEFAULT_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0.2,
        max_tokens: outputTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(site, docs, charBudget) },
        ],
      }),
    });

    if (res.ok) {
      learnedBudgets.set(budgetKey, charBudget);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new GroqError('AI response missing content', 'bad-shape');
      return sanitizeFlags(extractJson(content));
    }

    const body = await res.text().catch(() => '');
    if (res.status === 413 && charBudget > MIN_INPUT_CHARS) {
      charBudget = budgetFromLimit(body, outputTokens) ?? Math.max(MIN_INPUT_CHARS, Math.floor(charBudget / 2));
      continue;
    }
    if (res.status === 429) {
      // Depleted credits are permanent — retrying won't help. (Ordinary rate-limit
      // bodies can mention "billing" in upgrade links, so match narrowly.)
      if (/depleted|prepay|insufficient[_ ]credit/i.test(body)) {
        const detail = (body.match(/"message":\s*"([^"]+)"/) || [])[1] || 'account quota exhausted';
        throw new GroqError(`Provider quota issue: ${detail.slice(0, 160)}`, 'quota');
      }
      if (attempt < 4) {
        const retryAfter = Number(res.headers.get('retry-after')) || 15;
        await sleep(Math.min(retryAfter, 60) * 1000 + 500);
        continue;
      }
      throw new GroqError('Rate limit hit — try again in a moment', 'rate-limit');
    }
    if (res.status === 401) throw new GroqError('The provider rejected the API key', 'bad-key');
    throw new GroqError(`AI request failed (${res.status}): ${body.slice(0, 200)}`, 'http');
  }
  throw new GroqError('AI kept rejecting the request — try again later', 'http');
}
