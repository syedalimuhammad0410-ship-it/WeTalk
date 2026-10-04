# Security

- **Authentication**: bcrypt (cost 12) passwords; random 256-bit session tokens stored as SHA-256 hashes; `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookies; 30-day expiry; “sign out other sessions”. Google sign-in uses OAuth 2.0 with a state cookie compared in constant time.
- **Authorization**: every API route goes through `api()` which resolves the user's workspace and checks a permission from the role matrix (`src/lib/permissions.ts`). Every query is scoped by `workspaceId`; cross-tenant access returns 404 (covered by `tests/e2e/api-security.spec.ts`).
- **CSRF**: state-changing requests must carry an `Origin` matching `APP_URL`.
- **Rate limiting**: Postgres-backed fixed windows for sign-in (per IP and per account), sign-up, password change and inbound webhooks.
- **Secrets**: API keys/OAuth tokens encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`); never returned by any API (only a `••••1234` hint). No `NEXT_PUBLIC_` secrets; server modules throw if bundled into the browser.
- **Input/Output**: Zod validation on every body; React escaping; CSV export neutralises formula injection.
- **SSRF**: the audit fetcher resolves DNS and refuses private/link-local/loopback ranges and non-standard ports, re-validating every redirect hop; responses are size-capped.
- **Crawling ethics**: robots.txt respected (5xx = disallow), polite delays, identifiable User-Agent, no CAPTCHA/login/paywall bypass — blocked sites are marked “Manual review”.
- **Headers**: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Audit logging**: important actions (status changes, sends, AI approvals, automation toggles, integration changes, exports, deletions) go to `ActivityLog`.
- **Row-level security**: the app enforces tenancy in code (it is the only database client). On Supabase apply `prisma/sql/supabase-rls.sql` so the public Data API cannot access tables.
