@AGENTS.md

# TRACE — project handoff notes (read this first in a new chat)

TRACE is an AI visual-investigation web app: upload an image → it extracts clues (OCR, logos, flags, scene),
researches public sources, proposes candidate locations with evidence, builds an evidence board/map/timeline,
and profiles the subjects in the image (companies, airlines, landmarks, memes). Owner: syedalimuhammad0410@gmail.com
(the welcome screen says "Welcome Mr Naqvi"). Never store or display plaintext passwords; never fabricate sources.

## Where things are
- Live (production): https://trace-investigations.trace-investigations.workers.dev (Cloudflare Workers, free plan)
- Old host: https://trace-investigations.netlify.app — stale; Netlify build credits ran out, not used anymore.
- Code: Next.js 16 (App Router; read `node_modules/next/dist/docs/` before using unfamiliar APIs), React 19, Tailwind v4,
  TypeScript, zod v4. Cloudflare build via OpenNext (`open-next.config.ts`, `wrangler.jsonc`).

## Commands
- `npm test` (vitest, 14 tests) · `npx tsc --noEmit -p .` · `npx next build`
- Local Workers runtime: put secrets in `.dev.vars` (gitignored), then `npx opennextjs-cloudflare build && npx wrangler dev`
- Deploy: `npx opennextjs-cloudflare build && npx wrangler deploy` — needs env vars `CLOUDFLARE_API_TOKEN`
  (Edit Cloudflare Workers template) and `CLOUDFLARE_ACCOUNT_ID` (8317660aa66ef001e08172daf6d654a6).
  Add them in this environment's settings; never paste tokens into chat or commit them.
- Worker secrets already set in Cloudflare: AUTH_SECRET, AUTH_PASSWORD_HASH (scrypt, `npm run hash-password -- '<pw>'`),
  GEMINI_API_KEY, TAVILY_API_KEY, MAPILLARY_ACCESS_TOKEN. Storage: Workers KV binding `TRACE_KV`.
- Browser end-to-end check: `BASE=<url> E2E_EMAIL=... E2E_PASSWORD=... UPLOAD=<image> node scripts/geo-e2e.mjs`
  (in Claude cloud sessions add `CHROME=/opt/pw-browsers/chromium` and the proxy SPKI flag via `CHROME_ARGS`).

## Map of the code
- Pipeline (runs in the browser): `src/lib/engine/runner.ts` — phases ingest → extract → OCR → search (+ subject dossiers)
  → candidates (+ AI geolocation, clue-combination map search) → visual matching → case → result.
- Reasoning/scoring: `src/lib/engine/reasoning.ts` (signals text/logo/link/visual/geo/temporal/exif/ai; conclusion text).
- Server research: `src/lib/server/research.ts` (search fan-out, entities, candidates, AI-hypothesis verification,
  nearby photos, OSM combo plan/results), `src/lib/server/dossier.ts` (subject profiles from Wikidata/Wikipedia/news),
  `src/lib/server/agent.ts` (TRACE AI chat with tools; Claude or Gemini).
- AI providers: `src/lib/providers/ai.ts` — free Gemini preferred (model fallback chain, per-attempt timeouts);
  Claude only if `AI_PROVIDER=claude`. Search providers: `src/lib/providers/search.ts`.
- In-browser vision: `src/lib/vision/*` (Florence-2 OCR with centre + quadrant tiles, CLIP, DETR via transformers.js CDN).
- UI: `src/components/workspace/*` (Result, Subjects/DossiersView, Images, Board, Map, Candidates, Sources, Chat…).
- Persisted investigation shape is validated in `src/lib/server/investigations.ts` — **add any new Investigation field there
  or it is silently dropped on save.**

## Hard-won gotchas
- Cloudflare: DuckDuckGo and GDELT block/ratelimit Workers IPs (DDG is skipped there; Tavily covers web+news);
  `sharp` cannot run (pure-JS EXIF strip + size fallback in `src/lib/server/images.ts`); no Node middleware
  (auth gate lives in `src/app/app/layout.tsx`).
- Overpass (OpenStreetMap queries) rations slots per IP: queries run from the user's browser (`src/lib/client/overpass.ts`).
- Hugging Face rejects model downloads referred from *.workers.dev → models are fetched with `referrerPolicy: "no-referrer"`.
- Mapillary images are signed CDN URLs: load directly in the browser (see `proxied()` in `src/lib/client/api.ts`).
- Wikimedia APIs rate-limit aggressive callers; keep the identifying User-Agent and caching in `src/lib/server/http.ts`.
- Don't `pkill -f "next start"` in cloud sessions (it kills the shell); stop background servers by task id.
- Commit messages: no model names; end with the attribution lines the session provides.
