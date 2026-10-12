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

- **Outreach emails** may mention the price of the one package that covers what the business needs, and only if it clearly fits.
- **Reply drafts** for pricing questions work out what the business needs (to be found and contacted, quote or booking requests, online booking, payments, ordering or a store) and recommend the one package that covers it, saying why. They use the lead's business type, website status and audit findings. Pricing is by requirements: the AI never mentions pages or per-page prices. They quote the exact figures, list what the package includes, and may offer the monthly website-management plan and one or two relevant add-ons. They ask scoping questions and give a next step.
- The AI never adds up totals, applies discounts or uses a figure that isn't in the price list. The commitment scanner compares amounts by value ($2500 = $2,500 = 2,500 CAD) and blocks any other figure.

With pricing switched off, the AI explains what affects the price, asks scoping questions and offers a tailored quote.

## WebScout AI assistant

Click **Ask WebScout AI** at the bottom of the sidebar (on phones it's in the menu). The assistant uses the connected AI provider and has the same permissions as the person using it.

- **Looks up:** workspace overview, lead search and lead details, inbox and conversations, background jobs, campaigns, your company profile and pricing.
- **Runs directly:**
  - change a lead's status, add notes, tag leads
  - queue website audits or website prompts
  - write an outreach email draft (never sent automatically)
  - start a business search
  - add leads to a campaign
  - move emails in or out of Filtered, clean up the inbox
- **Asks you to confirm first:** sending an email, approving and sending an AI reply, Do Not Contact.

Email text from outside senders is marked as untrusted, so instructions inside an email are ignored.

## Gemini free-tier limits

Google's free tier gives each model a small daily allowance (about 20 requests per day per model at the time of writing) and a per-minute limit. WebScout uses the newest Gemini Flash model first. When that model's daily allowance runs out, it switches to the next Flash model, then to the Flash-Lite models, and remembers which ones are used up until they reset.

Busy (503) and per-minute (429) responses are retried automatically. When every model's daily allowance is used up, you see a clear message. For regular use, turn on billing for the key at aistudio.google.com; the paid limits are far higher and cost little at this volume.
