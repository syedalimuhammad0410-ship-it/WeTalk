# Installation

Requirements: Node.js 20+ (22 recommended), PostgreSQL 14+ (16 recommended; the `pg_trgm` extension is used for fast search and is available on Supabase, Neon, RDS and stock Postgres).

```bash
git clone <repo> && cd <repo>
npm install
cp .env.example .env
# Edit .env: DATABASE_URL, APP_URL, APP_ENCRYPTION_KEY (openssl rand -base64 32)
npx prisma migrate deploy
npm run dev
```

Open http://localhost:3000, create an account (the first account becomes a system administrator), and complete the setup wizard.

### Optional: demo data
In the last onboarding step choose **Explore with demo data**. This creates a *separate* workspace named “Demo workspace (DEMO DATA)” with sample businesses, a SANDBOX mailbox and `.invalid` email addresses. Demo data is never mixed with real workspaces and every screen shows a DEMO banner.

### Background jobs
By default (`JOB_RUNNER=inline`) the web process runs background jobs (discovery, bulk audits, bulk prompts, inbox sync, reply analysis, follow-up dispatch). For multiple web instances set `JOB_RUNNER=external` and run `npm run worker` (safe to run several — jobs are claimed with `FOR UPDATE SKIP LOCKED`).
