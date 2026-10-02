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
  };
}

export function aiProvider(ctx: ProviderContext): AIProvider {
  return anthropicProvider(ctx);
}

export function anthropicClient(ctx: ProviderContext) {
  const key = ctx.secrets.ANTHROPIC_API_KEY;
  if (!key || !ctx.prefs.aiEnabled) return null;
  return new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 });
}
