# Testing

## Unit + integration (Vitest, real PostgreSQL)
```bash
createdb webscout_test            # once; tests refuse to run on a DB not named *_test
npm test
```
`tests/setup/global.ts` applies migrations and truncates the test database. External services are replaced at the HTTP boundary (`fetch` spies for Google Places and Postmark), via the email-provider override, and via a scriptable fake Claude (`tests/helpers.ts`). Website audits run against real local fixture sites (`tests/fixtures/sites`).

Covered: auth/roles, discovery pagination/dedupe/filters/quota errors, website detection (outdated, modern, robots-blocked, unavailable, none, SSRF), scoring & classification, prompt generation (structure, business specificity, quality ≥ 85, concise/expand, add/remove feature, versions/restore, AI acceptance, AI hallucination rejection), outreach from verified observations, sending limits/suppression/DNC/provider failure/Postmark headers, inbound matching (reply hash, In-Reply-To, sender, domain, unmatched, idempotency), unsubscribe → DNC, whole-thread AI analysis (“Tuesday works”), approval flow, automatic-reply safeguards, AI controls, follow-up approval/automatic/stop conditions, analytics/dashboard/campaign numbers, filters, CSV export & injection safety.

## End-to-end (Playwright)
```bash
node tests/tools/fixture-server.mjs outdated 4010 &   # fixture site for audits
# .env for the app under test: AUDIT_ALLOW_PRIVATE_HOSTS="true", SIGNUP_RATE_LIMIT_PER_HOUR="500"
npm run dev &
npm run test:e2e
```
`tests/e2e/full-workflow.spec.ts` drives the real UI: sign-up → onboarding → add lead → audit → prompt (edit, concise, history, restore) → outreach → confirm & send (sandbox) → simulated reply → classification → follow-ups stopped → unsubscribe → DNC → dashboard/dark mode. `tests/e2e/api-security.spec.ts` checks authentication, CSRF, tenant isolation, roles, secret redaction, rate limiting and validation over HTTP.
