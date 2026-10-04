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
