# Deployment

## Render (free)

`render.yaml` is a ready-made Render Blueprint for the free plan:

1. In Render, go to **New → Blueprint**, connect this GitHub repository and choose the branch.
2. Fill in the prompted values:
   - `DATABASE_URL`: Supabase *Transaction pooler* URI ending in `?uselibpqcompat=true&sslmode=require`.
   - `GOOGLE_MAPS_API_KEY`: optional.
   - `ANTHROPIC_API_KEY`: optional.
   
   `APP_ENCRYPTION_KEY` is generated for you, and `APP_URL` defaults to the Render URL.
3. Free services sleep after 15 idle minutes. To keep the site awake and background jobs running, create a free job at cron-job.org (or similar) that sends `GET https://<your-app>.onrender.com/api/ping` every 10 minutes.

Apply the database schema once (`npx prisma migrate deploy`) before the first start.


Any Node host (Vercel, Render, Fly.io, Railway, a VM) + PostgreSQL.

```bash
npm ci
npx prisma migrate deploy
npm run build
npm start                      # PORT defaults to 3000
```

Checklist
- Set `APP_URL` to the public HTTPS URL and a strong `APP_ENCRYPTION_KEY`.
- Never set `AUDIT_ALLOW_PRIVATE_HOSTS` in production.
- Consider `ENABLE_EMAIL_SANDBOX=false`.
- Serverless platforms (e.g. Vercel) don't keep a process alive: set `JOB_RUNNER=external` and run `npm run worker` on a small always-on instance (or container) pointing at the same database.
- Configure Gmail OAuth redirect URI / Postmark inbound webhook with the production `APP_URL`.
- Back up the database (point-in-time recovery recommended).

## Cloudflare Workers

The app deploys to Cloudflare Workers through the OpenNext adapter
(`@opennextjs/cloudflare`). The repository already contains everything needed:

- `wrangler.jsonc`: Worker config. It sets `nodejs_compat`, `global_fetch_strictly_public` (outbound fetches can only reach the public internet), a once-a-minute cron trigger, and `JOB_RUNNER=cron`.
- `worker.ts`: the Worker entry. It gives every request its own database client, because Workers can't share sockets between requests. The cron trigger calls `/api/internal/cron`, which runs queued background jobs.
- `open-next.config.ts`: OpenNext build settings.

### 1. Database (via Cloudflare Hyperdrive)

Workers need a PostgreSQL database reachable over the internet, for example
Supabase or Neon. Apply the schema once (`DATABASE_URL="postgresql://…" npx
prisma migrate deploy`), then put **Hyperdrive** in front of it. Workers verify
TLS certificates strictly and can't reach Supabase's pooler directly, because it
uses a private certificate authority. Hyperdrive handles the TLS connection and
pools connections.

```bash
# Supabase: use the *Session pooler* (port 5432). Keep caching disabled.
npx wrangler hyperdrive create webscout-db --caching-disabled \
  --connection-string="postgresql://USER:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

Put the returned id in `wrangler.jsonc` → `hyperdrive[0].id`. Each request then
connects through `env.HYPERDRIVE`; `DATABASE_URL` is only a fallback when no
binding exists. `opennextjs-cloudflare deploy` also needs a local stand-in:
`export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://…local…`.

### 2. Secrets

```bash
npx wrangler login                     # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put APP_ENCRYPTION_KEY # openssl rand -base64 32
npx wrangler secret put CRON_SECRET        # openssl rand -hex 24
npx wrangler secret put APP_URL            # https://webscout-ai.<you>.workers.dev or your domain
# Optional provider keys (or add them later in Settings → Integrations):
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_MAPS_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### 3. Deploy

```bash
npm run cf:deploy       # builds with OpenNext, then uploads with wrangler
```

`npm run cf:preview` runs the same build locally in the Workers runtime. For
that, put local values in `.dev.vars`, which is git-ignored.

### Notes

- **Plan: Workers Paid is required.** The free plan allows 10 ms of CPU per request. Page rendering and password hashing often go over that, which Cloudflare reports as 503 "Worker exceeded CPU time limit". Workers Paid ($5/month) allows 30 s.
- **Background jobs.** These are discovery, bulk audits and prompts, inbox sync and follow-ups. They start within about a minute of being queued, on the next cron tick. Single-lead actions (audit, prompt, outreach, send) run immediately in the request.
- **Website audits.** On Workers, DNS is resolved over HTTPS (1.1.1.1). Private addresses are refused twice: by the app's SSRF guard and by `global_fetch_strictly_public`.
- **OAuth and webhooks.** The Gmail OAuth redirect URI and the Postmark inbound webhook must use the Worker's public `APP_URL`.
