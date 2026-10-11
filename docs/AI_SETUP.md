# AI setup (Anthropic Claude)

Add a key in **Settings → Business Discovery & AI keys** (tested, encrypted) or set `ANTHROPIC_API_KEY`. Choose the model and effort in **Settings → AI** (default `claude-opus-5-5`, effort `medium`). Requests use adaptive thinking, structured outputs (Zod schemas) for JSON tasks, streaming for long prompt rewrites, and server-side refusal fallbacks where supported. Usage is recorded per feature (Admin → Usage).

Every AI feature also works without AI where possible — and is clearly labelled when it doesn't:

| Feature | With Claude | Without |
|---|---|---|
| Website facts | Extracts services/claims; **each item must quote text found on the site** or it's dropped | Structural audit only |
| Website prompt | Deepens the rule-based spec; rejected if it drops sections or adds unverified phones/prices/years/counts/ratings | Full rule-based spec (quality-scored) |
| Outreach | Writes from verified observations; scanned for unconfigured prices/guarantees/deadlines | Template + observations |
| Reply analysis | Reads the whole thread (resolves “Tuesday works”) | Rule-based classifier (always runs as a safety layer) |
| Reply drafts | Uses only your company profile; lists missing info (e.g. pricing) instead of inventing it | “Connect Anthropic to enable AI drafts” |

Automatic replies are default-deny: see `src/lib/server/replies/policy.ts` and the unit tests in `tests/unit/rules-policy.test.ts`.

## Google Gemini (alternative, has a free tier)

You only need one AI provider. If both are connected, Anthropic is used.

1. Go to **aistudio.google.com → Get API key** and create a key.
2. In WebScout, open **Settings → Integrations → AI provider — Google Gemini** and paste the key. It's tested before it's saved. You can also set `GEMINI_API_KEY` on the server.
3. WebScout uses the newest stable **Gemini Flash** model that the key can access. Set `GEMINI_MODEL` to override it, for example `gemini-2.5-pro`.

Gemini output goes through the same schema validation, fact guard and safety rules as Claude output. If an answer is cut off, blocked or doesn't match the expected format, nothing is saved and you see a clear error.


## Pricing and quotes

The AI quotes prices only from **Settings → Company profile → Pricing** (with pricing switched on):

- **Outreach emails** may mention one "starting from" price for the best-fitting package, and only if it clearly fits.
- **Reply drafts** for pricing questions recommend one package and say why, using the lead's business type, website status and audit findings. They quote the exact figures, list what the package includes, and may offer the monthly website-management plan and one or two relevant add-ons. They ask scoping questions and give a next step.
- The AI never adds up totals, applies discounts or uses a figure that isn't in the price list. The commitment scanner compares amounts by value ($2500 = $2,500 = 2,500 CAD) and blocks any other figure.

With pricing switched off, the AI explains what affects the price, asks scoping questions and offers a tailored quote.
