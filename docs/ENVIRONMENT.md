# Environment variables

Secrets live **only** in server environment variables or encrypted in the database. Nothing below is ever sent to the browser (no `NEXT_PUBLIC_` variables are used).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_URL` | yes | Public base URL (OAuth redirects, invite links, webhook URLs) |
| `APP_ENCRYPTION_KEY` | yes | ≥ 32 random characters. AES-256-GCM key material for stored API keys and OAuth tokens. **Changing it makes stored credentials unreadable** — reconnect integrations afterwards |
| `ANTHROPIC_API_KEY` | no | Server-wide default Claude key. Workspaces can instead save their own (encrypted) key in Settings |
| `GEMINI_API_KEY` | no | Google Gemini key (aistudio.google.com). Used for AI features when no Anthropic key is set; can also be added per workspace in Settings → Integrations |
| `GEMINI_MODEL` | no | Override the Gemini model (default: newest stable `gemini-*-flash` the key can use) |
| `GOOGLE_MAPS_API_KEY` | no | Server-wide default Google Maps Platform key (Places API (New); optionally PageSpeed Insights API) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Enables Google sign-in and Gmail connection (OAuth 2.0) |
| `JOB_RUNNER` | no | `inline` (default), `external` (use `npm run worker`) or `cron` (serverless/Cloudflare: jobs run when `/api/internal/cron` is called each minute) |
| `CRON_SECRET` | with `cron` | Bearer secret (24+ chars) that `/api/internal/cron` requires. Without it the endpoint returns 404 |
| `ENABLE_EMAIL_SANDBOX` | no | `true` (default) allows the clearly-labelled email sandbox. Set `false` in production if you don't want it offered |
| `SYSTEM_ADMIN_EMAILS` | no | Comma-separated emails that become system admins on sign-up (see all workspaces in Admin) |
| `SIGNUP_RATE_LIMIT_PER_HOUR` | no | Sign-ups per IP per hour (default 10) |
| `AUDIT_ALLOW_PRIVATE_HOSTS` | no | **Tests/local only.** `true` disables the SSRF private-network block so fixture sites on 127.0.0.1 can be audited. Never set in production |

Only integrations you actually use need credentials.
