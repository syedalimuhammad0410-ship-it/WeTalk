# Mathly — an AI math tutor that grows with you

> **Don't just get the answer. Learn how to think.**

Mathly is a full-stack math learning platform for Kindergarten through university. Every problem is taught with the same framework — **Understand → Plan → Solve → Check → Communicate** — and every answer key is verified by a math engine before a student sees it.

## Quick start

```bash
cd mathly
npm install
cp .env.example .env      # optional — everything works without keys
npm run dev               # API on :8787, web app on http://localhost:5173
```

Production:

```bash
npm run build && npm start   # serves the built app + API on $PORT (default 8787)
```

Requires **Node 22.18+** (uses built-in `node:sqlite` and native TypeScript type-stripping — no build step for the server).

## What's inside

| Area | Highlights |
|---|---|
| **Accounts** | Guest mode with no sign-up (secure device cookie), email/password, Google / Microsoft / Apple OAuth (activate via env vars). Guests upgrade in place and keep everything; signing in on a device with guest profiles merges them. |
| **Profiles** | Up to 8 learner profiles per account with separate XP, mastery, courses, streaks, history and preferences. Optional parental PIN. |
| **Onboarding** | Step-by-step, skippable: name, school level (K → adult), country/curriculum (grade naming adapts: UK "Year", IB "MYP", Pakistan/India "Class"…), course, purposes, interests, learning style, goals, daily goal. |
| **Placement** | Adaptive per-domain bisection across up to 12 areas. Produces an overall learning level (e.g. *Grade 8.1*), per-area levels, topic mastery %, strengths, gaps, missing prerequisites and a recommended path. |
| **Learning engine** | Mastery (0–100) per skill from accuracy, difficulty, hints, recency (forgetting-curve decay with spaced review), explanations and tests. Learning level is recomputed continuously. Recommender weighs prerequisites, level fit, course, interests, review due and recent struggles. |
| **Curriculum** | 110+ skills across 15 domains (numbers → real analysis), 18 courses (K, Grades 1–3/4–6/7–8/9–12, Algebra I, Calculus I/II, Multivariable & ODEs, Linear Algebra, Discrete Math, Abstract Algebra & Analysis, Statistics, Financial/Everyday/Engineering math, Mental math, Puzzles). |
| **Questions** | A generator per skill (adaptive difficulty 1–5, interactive SVG visuals, hints, worked steps, common-mistake detection). Each generated question is **machine-verified** (mathjs: numeric, equation substitution, roots, symbolic derivatives, antiderivatives, equivalence) and regenerated if verification fails. |
| **Lessons** | Learn → Example (step reveal) → Try it → Practice → Challenge → Explain it (scored) → Quick check. |
| **Practice modes** | Practice, Mental math, Puzzles, Game (Number Blitz: lives + combos), Visual, Tutor mode, Challenge, Speed (60 s), Real-world, Review, Targeted. Self-reported confidence adapts difficulty. |
| **Help ladder** | Think → Hint → Concept → Next step → Similar example → Full solution (Learning Mode on by default; full solutions earn no XP). |
| **AI tutor** | Claude (server-side) with full learner context, Socratic pedagogy and a verified-calculator tool so it never states unchecked arithmetic. Without a key, a built-in tutor gives hints, explanations at different levels, examples, quizzes (with answer checking) and step-by-step equation solving. Voice input, read-aloud and hands-free mode via the Web Speech API. |
| **Homework helper** | Photo/screenshot/PDF upload (content-sniffed, private storage, original never modified) or typed problems. AI vision returns problems, tappable highlighted regions and handwriting assessment; answers are cross-checked by the math engine. 6-step guided workflow with the answer hidden until the student works through it. |
| **Learn Anything** | Type any goal ("the math behind rockets"). The planner maps it onto the skill graph, checks the learner's mastery, inserts a prerequisite review mini-course and orders units. With AI, Claude designs the course and writes new lessons; every AI practice question must pass mathematical verification or it's dropped. All requests are stored for the admin's "most requested topics". |
| **Test prep** | Wizard (topic, date, confidence, calculator, format) → day-by-day plan (concepts, practice, weak topics, mixed, mock test, test-day warm-up, rest days) that automatically re-schedules missed days; readiness estimate per topic; randomized mock tests (MC / short / written, timed or not) with mistake analysis and recommendations. |
| **Presentation practice** | Voice, video (stays on device) or typed. Rubric feedback on accuracy (spoken arithmetic is checked), clarity, organization, vocabulary, reasoning, pace, filler words and pauses — behavioral, never psychological. |
| **Gamification** | XP (admin-tunable rules), levels with unlocks (themes, avatars, modes), 18 achievements with animated celebrations, forgiving streaks with automatic freezes, daily challenge. XP measures engagement; mastery measures learning. |
| **Planning** | Natural-language planner ("Math test October 15"), 6-week calendar, homework organizer that breaks assignments into tasks and suggests today's workload. |
| **Parents & teachers** | Weekly reports per learner (time, questions, accuracy trend, level, strongest / needs practice) — private tutor chats are never included. |
| **Admin** | Role-based (moderator / admin / super admin): overview & system health, users & roles, course review/approval and authoring, topic requests, flagged content, XP rules, achievements, resources, privacy-safe analytics, audit log. |
| **Platform** | Mobile-first responsive UI, light/dark/system themes, age-adaptive UI (K–2 simplified, university denser), text size, high contrast, reduced motion, keyboard navigation, ⌘K search, notifications (in-app + optional browser), offline banner and service-worker caching of viewed lessons. |

## Configuration (`.env`)

All integrations are optional — see `.env.example` and the in-app **/setup** page.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `AI_MODEL` | Conversational AI tutor, homework photo reading, AI course generation, richer feedback (default model `claude-opus-5-5`). |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `APPLE_*` | OAuth sign-in. Redirect URIs: `$PUBLIC_URL/api/auth/oauth/<provider>/callback`. |
| `ADMIN_EMAILS` | Comma-separated emails that become admins on registration. |
| `PUBLIC_URL`, `PORT`, `DATABASE_PATH`, `UPLOAD_DIR` | Deployment settings. |

The app name lives in `shared/curriculum.ts` (`APP_NAME`) and `server/config.ts` (`APP_NAME` env) for easy renaming.

## Security & privacy

- Secrets only in server env vars; all AI calls are server-side. HttpOnly, SameSite session cookies (hashed tokens in DB), scrypt password hashing.
- CSRF protection (required custom header on mutations), strict per-profile ownership checks, role-based admin permissions with audit log.
- Input validation on every endpoint, rate limiting (API, auth, guest creation, AI), upload type sniffing + size limits, hardened mathjs instance for untrusted input (no `import`/`evaluate`/`parse`), CSP and security headers in production, no stack traces in responses.
- Minimal data: first name/nickname only for learners. Export (JSON) and delete for profiles and accounts; analytics store event counts only (opt-out per profile). Educational data is never sold.

## Tests

```bash
npm test             # generator verification (110+ skills × 5 difficulties × 40 seeds) + API integration tests
npm run build && npm run test:e2e   # Playwright browser E2E: full tour + 10 core cycles + responsive + dark mode
```

The E2E suite writes screenshots to `tests/e2e/screenshots/`.

## Architecture

```
shared/        skill catalog, curriculum, courses, achievements, types (used by client + server)
server/        Express API (TypeScript run natively by Node)
  engine/      question generators, answer checking & verification, problem solver
  ai/          provider abstraction (Claude), tutor (+ built-in fallback)
  routes/      profiles, learning, AI features, plans, admin
  learning.ts  mastery, levels, XP, streaks, achievements, recommendations
  coursegen.ts Learn Anything course builder with validation
src/           React app (Vite + Tailwind v4 + motion)
tests/         unit, integration (real server + DB) and browser E2E
```

The curriculum is data-driven: add a skill to `shared/skills.ts` plus a generator in `server/engine/`, and it automatically joins the skill tree, recommendations, search, placement and course builder. The domain model is subject-agnostic, so new subjects can be added alongside math.
