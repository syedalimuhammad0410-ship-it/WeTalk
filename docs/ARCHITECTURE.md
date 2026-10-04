# Architecture

```
Browser (React, Next.js App Router)
  │  server components read data directly; client islands call JSON APIs, then router.refresh()
  ▼
Next.js route handlers  src/app/api/**        — auth, CSRF origin check, Zod validation, role checks (lib/server/api.ts)
  ▼
Domain services        src/lib/server/**
  ├─ discovery/   Google Places client + discovery job
  ├─ audit/       SSRF-safe fetcher, robots, HTML analysis, scoring, classification
  ├─ intel/       business-type playbooks, feature library, opportunity scoring
  ├─ prompts/     context → composer → quality rubric → (AI enhance + fact guard)
  ├─ email/       providers (Gmail, Postmark, Sandbox), send pipeline, inbound matching, compose
  ├─ replies/     rule classifier, AI analysis & drafting, auto-send policy, approvals
  ├─ followups.ts, leads.ts, queries.ts, health.ts, members.ts
  └─ jobs/        Postgres-backed queue (SKIP LOCKED), runner, handlers
  ▼
PostgreSQL (Prisma)          External: Anthropic · Google Places/PageSpeed · Gmail · Postmark
```

Key decisions
- **One send path** (`email/send.ts`) so every email — manual, bulk, follow-up, automatic — passes the same compliance checks.
- **Deterministic first, AI second.** Audits, scores, opportunity, prompt structure and safety classification are deterministic and explainable; AI deepens content and is verified before use.
- **Default deny** for automatic replies; reasons are stored and shown.
- **Jobs in Postgres** — no extra infrastructure; progress, cancel and retry are first-class.
