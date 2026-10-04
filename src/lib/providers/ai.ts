import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import type { ProviderContext } from "@/lib/server/settings";
import { recordUsage } from "@/lib/server/usage";
import type { AiVisionResult } from "@/lib/types";

/**
 * AIProvider abstraction. The Anthropic implementation is the default; additional
 * providers implement the same interface. Every method returns structured data —
 * the model never fabricates sources: it only sees and cites IDs we pass in.
 */
export interface AIProvider {
  id: string;
  model: string;
  configured(): boolean;
  analyzeImage(img: { base64: string; mime: string }, opts: { mode: string; focus?: string; instructions?: string }): Promise<AiVisionResult>;
  compareImages(a: { base64: string; mime: string }, b: { base64: string; mime: string }, context: string): Promise<AiComparison>;
  explainEvidence(factsJson: string): Promise<AiExplanation>;
  /** Proposes where the image was taken. Output is a hypothesis: coordinates are re-checked against map data and sources come only from real searches. */
  geolocate(imgs: { base64: string; mime: string }[], cluesText: string): Promise<AiGeolocation>;
}

export interface AiGeoGuess {
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  precision: "exact" | "street" | "neighbourhood" | "city" | "region" | "country";
  confidence: number;
  reasoning: string;
  keyClues: string[];
  searchQuery: string;
}

/** A combination of mappable features to look for together on OpenStreetMap. */
export interface OsmFeature {
  tags?: Record<string, string>;
  name?: string;
  label: string;
}
export interface OsmQuery {
  area: string;
  anchor: OsmFeature;
  near: OsmFeature[];
  radiusM: number;
}

export interface AiGeolocation {
  locations: AiGeoGuess[];
  overall: string;
  osmQuery?: OsmQuery | null;
}

export interface AiComparison {
  matches: { feature: string; strength: "strong" | "moderate" | "weak" }[];
  differences: string[];
  verdict: "consistent" | "inconsistent" | "inconclusive";
  note: string;
}

export interface AiExplanation {
  explanation: string;
  nextSteps: string[];
}

const VisionSchema = z.object({
  summary: z.string(),
  sceneType: z.string(),
  text: z.array(z.object({ text: z.string(), where: z.string(), confidence: z.enum(["high", "medium", "low"]) })),
  logos: z.array(
    z.object({ name: z.string(), category: z.string(), confidence: z.enum(["high", "medium", "low"]), alternatives: z.array(z.string()) }),
  ),
  architecture: z.array(z.string()),
  environment: z.array(z.string()),
  sport: z.object({ sport: z.string(), features: z.array(z.string()) }).nullable(),
  document: z
    .object({ publication: z.string().nullable(), date: z.string().nullable(), headline: z.string().nullable(), names: z.array(z.string()) })
    .nullable(),
  entities: z.array(z.object({ name: z.string(), type: z.string() })),
  suggestedQueries: z.array(z.string()),
  peopleNote: z.string().nullable(),
  flags: z.array(z.object({ country: z.string(), confidence: z.enum(["high", "medium", "low"]) })),
});

const CompareSchema = z.object({
  matches: z.array(z.object({ feature: z.string(), strength: z.enum(["strong", "moderate", "weak"]) })),
  differences: z.array(z.string()),
  verdict: z.enum(["consistent", "inconsistent", "inconclusive"]),
  note: z.string(),
});

const ExplainSchema = z.object({ explanation: z.string(), nextSteps: z.array(z.string()) });

const GeoSchema = z.preprocess(
  // accept a bare list of hypotheses, or a single hypothesis object, as well as {locations:[...]}
  (v) => (Array.isArray(v) ? { locations: v } : v && typeof v === "object" && "name" in v && !("locations" in v) ? { locations: [v] } : v),
  z.object({
  locations: z
    .array(
      z.object({
        name: z.string().min(1),
        address: z.string().nullable().catch(null).default(null),
        city: z.string().nullable().catch(null).default(null),
        region: z.string().nullable().catch(null).default(null),
        country: z.string().nullable().catch(null).default(null),
        lat: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().nullable().catch(null)).default(null),
        lng: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().nullable().catch(null)).default(null),
        precision: z.enum(["exact", "street", "neighbourhood", "city", "region", "country"]).catch("city"),
        confidence: z.preprocess((v) => { const n = typeof v === "string" ? parseFloat(v) : (v as number); return typeof n === "number" && n > 1 && n <= 100 ? n / 100 : n; }, z.number().min(0).max(1)).catch(0.3),
        reasoning: z.string().catch("").default(""),
        keyClues: z.array(z.string()).catch([]).default([]),
        searchQuery: z.string().catch("").default(""),
      }),
    )
    .default([]),
  overall: z.string().catch("").default(""),
  osmQuery: z
    .object({ area: z.string().min(2), anchor: z.object({ tags: z.record(z.string(), z.string()).optional().catch(undefined), name: z.string().optional().catch(undefined), label: z.string().catch("feature") }), near: z.array(z.object({ tags: z.record(z.string(), z.string()).optional().catch(undefined), name: z.string().optional().catch(undefined), label: z.string().catch("feature") })).max(3).catch([]).default([]), radiusM: z.number().min(20).max(500).catch(150) })
    .nullable()
    .catch(null)
    .default(null),
}),
);
const GEO_SHAPE = `{"locations":[{"name":string,"address":string|null,"city":string|null,"region":string|null,"country":string|null,"lat":number|null,"lng":number|null,"precision":"exact"|"street"|"neighbourhood"|"city"|"region"|"country","confidence":number(0-1),"reasoning":string,"keyClues":[string],"searchQuery":string}],"overall":string,"osmQuery":{"area":string,"anchor":{"tags":{string:string}|null,"name":string|null,"label":string},"near":[{"tags":{string:string}|null,"name":string|null,"label":string}],"radiusM":number}|null}`;
const geoPrompt = (cluesText: string) => `You are geolocating the image(s) above, like an expert OSINT geolocator (GeoGuessr-level skill).
Use EVERY clue: readable text and languages/scripts, business names, logos and sponsors, team branding, flags, phone-number and address formats, licence plates (format/colour only), road markings, signage style, driving side, bollards, utility poles, architecture, vegetation, terrain, climate, sun/shadows, and any landmark you recognise.
Clues already extracted by other tools (may contain OCR errors):
${cluesText || "(none)"}

Return up to 5 ranked location hypotheses, most specific first (a named venue/building/street if you can, otherwise neighbourhood, city, region or country).
- Give your best-estimate coordinates (decimal degrees) for each, or null if you truly cannot.
- confidence is your honest probability (0-1) that this hypothesis is correct; never overstate it.
- reasoning: 1-3 sentences citing the specific visible clues. keyClues: the 2-6 clues that matter most.
- searchQuery: one web search query that would verify the hypothesis.
- Do not identify private individuals or private homes. Do not invent sources or URLs.

osmQuery (optional, else null): if the exact spot is NOT certain but the image shows 2+ distinct features that are mapped in OpenStreetMap, describe them so a map search can find every place where they occur together.
- area: the most likely city or small region to search (never a whole large country), e.g. "Porto, Portugal".
- anchor: the most specific feature; near: up to 3 other features visible close to it; radiusM: how close they are (20-500).
- Each feature uses OpenStreetMap tags (e.g. {"amenity":"pharmacy"}, {"railway":"tram_stop"}, {"amenity":"place_of_worship","religion":"christian"}, {"shop":"supermarket"}) and/or a visible business name (e.g. "Pingo Doce"); label is a short human description.`;

const SYSTEM = `You are the vision and reasoning component of TRACE, a responsible visual-investigation tool for identifying PUBLIC places, venues, buildings, organizations, objects and documents.
Rules:
- Report only what is visibly present. Mark uncertain readings as low confidence. Never invent text, logos, or places.
- Do not identify private individuals. If people are visible, describe only non-identifying context (e.g. "spectators", "players in team uniforms"). Public figures may be named only if clearly captioned in-image.
- Do not infer residents or private addresses of individuals.
- Visual style clues (architecture, vegetation, road markings) are probabilistic; phrase them as possibilities.
- A team logo does not prove a home venue; note that away, neutral-site or temporary venues are possible.`;

type Img = { base64: string; mime: string };
const imgBlock = (i: Img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mime as "image/jpeg", data: i.base64 } });

export function anthropicProvider(ctx: ProviderContext): AIProvider {
  const key = ctx.secrets.ANTHROPIC_API_KEY;
  const model = ctx.prefs.aiModel || "claude-opus-5-5";
  const client = key ? new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 }) : null;

  async function parse<T>(op: string, schema: z.ZodType<T>, content: Anthropic.Beta.BetaContentBlockParam[], maxTokens = 4000): Promise<T> {
    if (!client) throw new Error("AI provider not configured. Set ANTHROPIC_API_KEY.");
    const started = Date.now();
    try {
      const res = await client.beta.messages.parse({
        model,
        max_tokens: maxTokens,
        system: SYSTEM,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        messages: [{ role: "user", content }],
      });
      recordUsage({ at: new Date().toISOString(), provider: "anthropic", op, ok: true, ms: Date.now() - started, costUnits: res.usage.input_tokens + res.usage.output_tokens });
      if (res.stop_reason === "refusal") throw new Error("The AI model declined this request.");
      if (!res.parsed_output) throw new Error("AI response could not be parsed.");
      return res.parsed_output as T;
    } catch (e) {
      recordUsage({ at: new Date().toISOString(), provider: "anthropic", op, ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  return {
    id: "anthropic",
    model,
    configured: () => Boolean(key) && ctx.prefs.aiEnabled,
    async analyzeImage(img, opts) {
      const r = await parse("analyzeImage", VisionSchema, [
        imgBlock(img),
        {
          type: "text",
          text: `Investigation mode: ${opts.mode}.${opts.focus ? ` Focus only on: ${opts.focus}.` : ""}${opts.instructions ? ` User instructions: ${opts.instructions}` : ""}
Extract EVERY useful clue for identifying where/what this is: all legible text (exact transcription, including small, rotated, partial and background text), every logo/brand/sponsor (jerseys, boards, signage, vehicles), every flag (name the country), architecture, environment, sport venue features, document fields, named entities (organizations, teams, venues, places, publications, events, dates), and 4-10 specific search queries a researcher should run. Keep entries short.`,
        },
      ]);
      return { model, ...r, document: r.document ? { ...r.document, publication: r.document.publication ?? undefined, date: r.document.date ?? undefined, headline: r.document.headline ?? undefined } : null, peopleNote: r.peopleNote ?? undefined };
    },
    async compareImages(a, b, context) {
      return parse("compareImages", CompareSchema, [
        { type: "text", text: "IMAGE A (under investigation):" },
        imgBlock(a),
        { type: "text", text: "IMAGE B (reference photo of a candidate):" },
        imgBlock(b),
        {
          type: "text",
          text: `Candidate context: ${context}. Compare concrete, checkable features (geometry, signage, logos, structure, materials, layout). List only matches you can actually see in BOTH images; label weak resemblances as weak. List differences. Remember the photos may be from different years or angles.`,
        },
      ], 2000);
    },
    async explainEvidence(factsJson) {
      return parse("explainEvidence", ExplainSchema, [
        {
          type: "text",
          text: `Write a plain-language explanation (4-7 sentences) of this investigation's current state for the user, using ONLY the facts below. Distinguish direct evidence, indirect evidence, inference and user-provided information. State uncertainty honestly; never claim certainty the facts don't support; do not add facts. Then list 2-5 concrete next steps.\n\nFACTS (JSON):\n${factsJson}`,
        },
      ], 2000);
    },
    async geolocate(imgs, cluesText) {
      const r = await parse("geolocate", GeoSchema, [...imgs.slice(0, 3).map(imgBlock), { type: "text", text: geoPrompt(cluesText) }], 3000);
      return r as AiGeolocation;
    },
  };
}

// ---------------- Google Gemini (free tier available via Google AI Studio) ----------------
// ordered by quality-per-second on the free tier; a busy model is skipped quickly (see per-attempt timeout)
const GEMINI_MODELS = (process.env.GEMINI_MODELS || "gemini-3-flash-preview,gemini-3.5-flash,gemini-3.1-flash-lite,gemini-flash-lite-latest").split(",");

/**
 * Raw Gemini generateContent with the free-tier model fallback chain. Returns the first
 * successful response and the model that produced it. `deadline` is an absolute ms timestamp.
 */
export async function geminiGenerate(key: string, body: Record<string, unknown>, deadline: number, op = "generate", skip: string[] = []): Promise<{ model: string; json: GeminiResponse }> {
  const started = Date.now();
  let lastErr = "";
  for (const [i, model] of GEMINI_MODELS.entries()) {
    if (skip.includes(model)) continue;
    const left = deadline - Date.now();
    if (left < 3000) break;
    const budget = i === GEMINI_MODELS.length - 1 ? left : Math.min(left - 2000, 11000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(budget),
      });
      const j = (await res.json().catch(() => ({}))) as GeminiResponse;
      if (!res.ok || j.error) {
        lastErr = `${model}: ${j.error?.message || res.status}`;
        continue;
      }
      recordUsage({ at: new Date().toISOString(), provider: "gemini", op, ok: true, ms: Date.now() - started, costUnits: j.usageMetadata?.totalTokenCount });
      return { model, json: j };
    } catch (e) {
      lastErr = `${model}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  recordUsage({ at: new Date().toISOString(), provider: "gemini", op, ok: false, ms: Date.now() - started, error: lastErr });
  throw new Error(`Gemini unavailable (${lastErr || "time budget exhausted"})`);
}

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
  inline_data?: { mime_type: string; data: string };
}
export interface GeminiResponse {
  error?: { message?: string; code?: number };
  candidates?: { content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { totalTokenCount?: number };
}

export function geminiProvider(ctx: ProviderContext): AIProvider {
  const key = ctx.secrets.GEMINI_API_KEY?.trim();
  let lastModel = GEMINI_MODELS[0];
  async function generate<T>(op: string, schema: z.ZodType<T>, parts: Record<string, unknown>[], shape: string): Promise<T> {
    if (!key) throw new Error("Gemini is not configured. Set GEMINI_API_KEY.");
    const deadline = Date.now() + 24000; // stay inside the serverless request limit
    let lastErr = "";
    // a model can answer with malformed JSON: retry on the next model in the chain
    const tried: string[] = [];
    while (deadline - Date.now() > 4000 && tried.length < GEMINI_MODELS.length) {
      const { model, json } = await geminiGenerate(
        key,
        {
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [...parts, { text: `Respond ONLY with JSON matching this shape (use null or [] when absent):\n${shape}` }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } },
        },
        deadline,
        op,
        tried,
      );
      tried.push(model);
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      try {
        let raw: unknown = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, "").trim());
        if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === "object") raw = raw[0]; // some models wrap the object in an array
        const parsed = schema.safeParse(raw);
        if (parsed.success) {
          lastModel = model;
          return parsed.data;
        }
        lastErr = `${model}: unexpected response format (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message})`;
      } catch {
        lastErr = `${model}: response was not JSON`;
      }
    }
    throw new Error(`Gemini unavailable (${lastErr})`);
  }
  const img = (i: Img) => ({ inline_data: { mime_type: i.mime, data: i.base64 } });
  // lenient schemas: Gemini sometimes omits empty fields
  const Lenient = z.object({
    summary: z.string().default(""),
    sceneType: z.string().default("unknown"),
    text: z.array(z.object({ text: z.string(), where: z.string().default(""), confidence: z.enum(["high", "medium", "low"]).catch("medium") })).default([]),
    logos: z.array(z.object({ name: z.string(), category: z.string().default(""), confidence: z.enum(["high", "medium", "low"]).catch("medium"), alternatives: z.array(z.string()).default([]) })).default([]),
    architecture: z.array(z.string()).default([]),
    environment: z.array(z.string()).default([]),
    sport: z.object({ sport: z.string(), features: z.array(z.string()).default([]) }).nullable().default(null),
    document: z.object({ publication: z.string().nullable().default(null), date: z.string().nullable().default(null), headline: z.string().nullable().default(null), names: z.array(z.string()).default([]) }).nullable().default(null),
    entities: z.array(z.object({ name: z.string(), type: z.string().default("other") })).default([]),
    suggestedQueries: z.array(z.string()).default([]),
    peopleNote: z.string().nullable().default(null),
    flags: z.array(z.object({ country: z.string(), confidence: z.enum(["high", "medium", "low"]).catch("medium") })).default([]),
  });
  const VISION_SHAPE = `{"summary":string,"sceneType":string,"text":[{"text":string,"where":string,"confidence":"high"|"medium"|"low"}],"logos":[{"name":string,"category":string,"confidence":"high"|"medium"|"low","alternatives":[string]}],"flags":[{"country":string,"confidence":"high"|"medium"|"low"}],"architecture":[string],"environment":[string],"sport":{"sport":string,"features":[string]}|null,"document":{"publication":string|null,"date":string|null,"headline":string|null,"names":[string]}|null,"entities":[{"name":string,"type":string}],"suggestedQueries":[string],"peopleNote":string|null}`;
  return {
    id: "gemini",
    get model() {
      return lastModel;
    },
    configured: () => Boolean(key) && ctx.prefs.aiEnabled,
    async analyzeImage(i, opts) {
      const r = await generate("analyzeImage", Lenient, [
        img(i),
        {
          text: `Investigation mode: ${opts.mode}.${opts.focus ? ` Focus only on: ${opts.focus}.` : ""}${opts.instructions ? ` User instructions: ${opts.instructions}` : ""}
Extract EVERY useful clue for identifying where/what this is: all legible text (exact transcription, including small, rotated, partial and background text), every logo/brand/sponsor (jerseys, boards, signage, vehicles), every flag (name the country), architecture, environment, sport venue features, document fields, named entities (organizations, teams, venues, places, publications, events, dates), and 4-10 specific search queries a researcher should run. Never identify private individuals.`,
        },
      ], VISION_SHAPE);
      return { model: `gemini:${lastModel}`, ...r, document: r.document ? { ...r.document, publication: r.document.publication ?? undefined, date: r.document.date ?? undefined, headline: r.document.headline ?? undefined } : null, peopleNote: r.peopleNote ?? undefined };
    },
    async compareImages(a, b, context) {
      return generate("compareImages", CompareSchema, [
        { text: "IMAGE A (under investigation):" },
        img(a),
        { text: "IMAGE B (reference photo of a candidate):" },
        img(b),
        { text: `Candidate context: ${context}. Compare concrete, checkable features. List only matches visible in BOTH images; label weak resemblances as weak. List differences. Photos may differ in year or angle.` },
      ], `{"matches":[{"feature":string,"strength":"strong"|"moderate"|"weak"}],"differences":[string],"verdict":"consistent"|"inconsistent"|"inconclusive","note":string}`);
    },
    async explainEvidence(factsJson) {
      return generate("explainEvidence", ExplainSchema, [
        { text: `Write a plain-language explanation (4-7 sentences) of this investigation's current state using ONLY these facts. Distinguish direct evidence, indirect evidence, inference and user-provided information; state uncertainty honestly; add no new facts. Then list 2-5 next steps.\n\nFACTS (JSON):\n${factsJson}` },
      ], `{"explanation":string,"nextSteps":[string]}`);
    },
    async geolocate(imgs, cluesText) {
      return (await generate("geolocate", GeoSchema, [...imgs.slice(0, 3).map(img), { text: geoPrompt(cluesText) }], GEO_SHAPE)) as AiGeolocation;
    },
  };
}

/** Claude when configured (paid), otherwise Gemini (free tier), otherwise unconfigured Claude stub. */
/** Paid Claude is used only when AI_PROVIDER=claude, or when no free Gemini key is set. */
export function preferClaude(ctx: ProviderContext) {
  return process.env.AI_PROVIDER === "claude" || !ctx.secrets.GEMINI_API_KEY;
}

export function aiProvider(ctx: ProviderContext): AIProvider {
  const claude = anthropicProvider(ctx);
  const gem = geminiProvider(ctx);
  if (gem.configured() && !preferClaude(ctx)) return gem;
  if (claude.configured()) return claude;
  return gem.configured() ? gem : claude;
}

export function anthropicClient(ctx: ProviderContext) {
  const key = ctx.secrets.ANTHROPIC_API_KEY;
  if (!key || !ctx.prefs.aiEnabled || !preferClaude(ctx)) return null;
  return new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 });
}
