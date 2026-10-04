# WebScout AI

**Find businesses. Understand their websites. Discover opportunities. Start better conversations.**

WebScout AI is a full-stack SaaS for small website agencies:

```
Local business → discovery → website audit → opportunity analysis
→ extremely detailed, business-specific website-building prompt
→ personalised, compliant outreach → email conversation
→ AI-assisted (human-approved) replies → follow-ups → pipeline → customer
```

| Area | What's implemented |
|---|---|
| Discovery | Google Places API (New) Text Search with minimal field mask, pagination, location bias, rating / website / open filters, de-duplication (place id, domain, phone+name, name+address), manual add & CSV import |
| Website audit | SSRF-safe, robots.txt-respecting crawler (home + up to 5 priority pages + broken-link sample), optional Google Lighthouse, 8 explainable category scores (every point traces to a check), classification (No website / Outdated / Single-page / Broken / Incomplete / Basic / Modern / Strong / Excellent / Manual review), findings labelled **Verified / Inferred / Unknown** |
| Business intelligence | 33 business-type playbooks (restaurant, cleaning, plumber, dentist, law firm, daycare, hotel…) that decide which features actually help *this* business |
| Opportunity score | 0–100 with itemised, signed reasons ("+45 No website detected…") |
| **Website prompt generator** | 5,000–7,000-word master prompt with 23 required sections (facts with sources, unknowns, audit, sitemap, page-by-page spec, homepage, design system, functionality, forms, responsive, a11y, SEO incl. JSON-LD, performance budgets, security, analytics events, content rules, owner checklist, edge cases, acceptance criteria, build order). 10-dimension quality score; auto-improves below 85. Optional Claude enhancement is fact-checked and discarded if it invents phones, prices, years, counts or ratings |
| Prompt editor | Full-screen editor: copy (prompt only), download, save, regenerate, improve, more detailed, more concise, add/remove feature, version history with restore |
| Outreach | Personalised from verified audit observations (AI or templates with `{{variables}}`), confirmation dialog (recipient, subject, message, business, source, campaign), bulk send with typed count confirmation |
| Email | Gmail (OAuth), Postmark (API + inbound webhook with per-conversation reply hash), and a clearly-labelled **SANDBOX** for testing. Compliance footer, daily/hourly limits, minimum delay, min days between contacts, suppression list — enforced atomically on every send |
| Inbox | Sections (All, Unread, New, AI draft ready, Interested, Follow-up, Needs human review, Hot, Closed), 3-panel conversation (business · thread · AI intelligence), review queue |
| Reply AI | Matching (reply hash → In-Reply-To → References → thread → sender → domain), rule-based safety classifier + Claude analysis of the whole thread, drafting that never invents prices/availability/terms, commitment scanner, default-deny auto-send policy |
| Controls | Manual / Approval required (default) / Automatic; Pause AI, Take Over, Resume AI, Do Not Contact; unsubscribe → immediate DNC |
| CRM | Pipeline board (drag & drop, keyboard "Move…"), status history, notes, tags, assignments, saved filters, 20+ filters, compare, campaigns, follow-ups, analytics, responses dashboard, notifications, activity log, global ⌘K search |
| Platform | Email/password + Google sign-in, workspaces, roles (Owner/Admin/Member/Viewer), onboarding wizard, admin control center & system health, background jobs (queued/running/completed/failed/cancelled), dark mode, mobile layouts, demo workspace (clearly labelled DEMO DATA) |

## Quick start

```bash
cp .env.example .env            # set DATABASE_URL and APP_ENCRYPTION_KEY
npm install
npx prisma migrate deploy
npm run dev                     # http://localhost:3000
```

Sign up, follow the 10-step setup wizard, and connect integrations (all optional — features that need one say *"Connect … to enable this feature"* instead of faking results).

## Documentation

- [Installation](docs/INSTALLATION.md) · [Environment variables](docs/ENVIRONMENT.md) · [Database](docs/DATABASE.md)
- [Google Places / PageSpeed setup](docs/API_SETUP.md) · [Email setup](docs/EMAIL_SETUP.md) · [AI setup](docs/AI_SETUP.md)
- [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

## Tech

Next.js 15 (App Router, TypeScript) · PostgreSQL + Prisma · Tailwind CSS · Anthropic Claude (`@anthropic-ai/sdk`) · Recharts · Vitest · Playwright.
