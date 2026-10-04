# TRACE — Turn images into evidence

AI visual investigation & geolocation research workspace. Upload an image; TRACE extracts clues (scene-text OCR, scene understanding, object detection, logos, EXIF), resolves entities in Wikipedia/Wikidata, generates candidate places (knowledge graph + maps), compares reference photos, tries to disprove the leading candidate, and builds an evidence board with traceable sources.

## Run locally
```bash
npm install
cp .env.example .env.local   # fill AUTH_* (npm run hash-password -- 'pw')
npm run dev                  # http://localhost:3000
npm test                     # unit tests (reasoning engine on real Wikidata fixtures)
```

## Deploy (Netlify)
Build `npm run build`, publish `.next` (see `netlify.toml`). Set the `AUTH_*` env vars in Netlify → Site configuration → Environment variables. Storage uses Netlify Blobs automatically. Add optional provider keys there too (never in code).

## Architecture
- `src/lib/engine/` – runner (8-phase pipeline), reasoning (evidence weighting, contradictions, falsification, confidence), graph, intents, reports
- `src/lib/vision/` – in-browser Florence-2 OCR, CLIP, DETR (WebGPU when available, WASM fallback), Tesseract (documents), enhancement, comparison
- `src/lib/providers/` – AIProvider (Claude), SearchProvider (Wikipedia, Brave, Tavily, GDELT, YouTube, LoC), MapProvider (OSM Nominatim/Overpass, Google), ImageSearchProvider (Commons, Cloud Vision web detection, SerpApi Lens), Wikidata
- `src/lib/server/` – auth, storage (Netlify Blobs / FS), cache, rate limit, usage logging
- `db/schema.sql` – relational schema for a future Postgres adapter

## Deploy to Cloudflare Workers

TRACE runs on Cloudflare Workers via the OpenNext adapter (storage: Workers KV; image processing falls back to a pure-JS metadata stripper because `sharp` is native).

```bash
export CLOUDFLARE_API_TOKEN=...   # token from the "Edit Cloudflare Workers" template
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler kv namespace create TRACE_KV        # put the printed id into wrangler.jsonc
npx wrangler secret put AUTH_SECRET              # 32+ random chars
npx wrangler secret put AUTH_PASSWORD_HASH       # npm run hash-password -- '<owner password>'
npx wrangler secret put GEMINI_API_KEY
npm run cf:deploy
```

Local preview on the Workers runtime: put the same three secrets in `.dev.vars`, then `npm run cf:preview`.
