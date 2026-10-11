import "../guard";
import { createHash } from "node:crypto";
import { toJSONSchema } from "zod";
import type * as z from "zod/v4";
import { AppError } from "../errors";
import type { AiJsonRequest, AiTextRequest } from "./client";

/**
 * Google Gemini over the Generative Language REST API (no SDK). Used when a
 * workspace connects a Gemini key instead of an Anthropic key.
 */
const API = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_OUTPUT = 65536;

type Usage = { input_tokens: number; output_tokens: number };
type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

export type GeminiFetch = typeof fetch;
let fetchImpl: GeminiFetch = (...a) => fetch(...a);
/** Test hook: replace fetch for the Gemini client (pass null to restore). */
export function setGeminiFetchForTests(f: GeminiFetch | null) {
  fetchImpl = f ?? ((...a) => fetch(...a));
  modelCache.clear();
}

async function call<T>(apiKey: string, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${API}/${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? 10 * 60_000),
    });
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") throw new AppError("UPSTREAM_TIMEOUT", "Gemini did not respond in time. Nothing was saved; please retry.");
    throw new AppError("NETWORK", "Could not reach Google Gemini (network error). Nothing was saved.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) throw mapGeminiError(res.status, data.error?.message ?? "", data.error?.status ?? "");
  return data;
}

export function mapGeminiError(status: number, message: string, code = ""): AppError {
  const msg = message.slice(0, 300);
  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(message) || status === 401) return new AppError("INVALID_CREDENTIALS", "Google rejected the Gemini API key. Update it in Settings → Integrations.");
  if (status === 403) return new AppError("INVALID_CREDENTIALS", `Gemini API access denied — check that the “Generative Language API” is enabled for this key's project. (${msg})`);
  if (status === 429 || code === "RESOURCE_EXHAUSTED") {
    if (/quota|billing|limit: 0/i.test(message)) return new AppError("QUOTA_EXCEEDED", `Gemini quota reached for this key. Nothing was generated. (${msg})`);
    return new AppError("RATE_LIMITED", "Gemini rate limit reached. Nothing was changed; retry in a minute.");
  }
  if (status === 404) return new AppError("NOT_CONFIGURED", `The Gemini model isn't available for this key. (${msg})`);
  if (status === 400) return new AppError("UPSTREAM_ERROR", `Gemini rejected the request: ${msg}`);
  if (status >= 500) return new AppError("UPSTREAM_ERROR", "Google Gemini is temporarily unavailable. Nothing was saved; retry shortly.");
  return new AppError("UPSTREAM_ERROR", `Gemini error ${status}: ${msg}`);
}

const modelCache = new Map<string, { model: string; at: number }>();

/** Picks the newest stable "gemini-X-flash" model the key can use (fast, has a free tier); cached for an hour. */
export async function resolveGeminiModel(apiKey: string, preferred?: string | null): Promise<string> {
  if (preferred && preferred.startsWith("gemini")) return preferred;
  const cacheKey = createHash("sha256").update(apiKey).digest("hex");
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.model;
  let model = DEFAULT_MODEL;
  try {
    const data = await call<{ models?: { name: string; supportedGenerationMethods?: string[] }[] }>(apiKey, "models?pageSize=1000", { method: "GET", timeoutMs: 20_000 });
    const versions = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => /^models\/(gemini-(\d+(?:\.\d+)?)-flash)$/.exec(m.name))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .sort((a, b) => Number(b[2]) - Number(a[2]));
    if (versions[0]) model = versions[0][1]!;
  } catch {
    /* fall back to the default model; the generate call reports real errors */
  }
  modelCache.set(cacheKey, { model, at: Date.now() });
  return model;
}

/** Gemini's structured output accepts a JSON-Schema subset; drop the meta keyword it doesn't need. */
function jsonSchemaFor(schema: z.ZodType) {
  const js = toJSONSchema(schema as never) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export class GeminiProvider {
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}

  private async generate(system: string, prompt: string, maxTokens: number, json?: { schema: Record<string, unknown>; inPrompt?: boolean }) {
    const userText = json?.inPrompt ? `${prompt}\n\nRespond with ONLY a JSON object (no markdown fences) that matches this JSON Schema:\n${JSON.stringify(json.schema)}` : prompt;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: Math.min(maxTokens, MAX_OUTPUT),
        ...(json ? { responseMimeType: "application/json", ...(json.inPrompt ? {} : { responseJsonSchema: json.schema }) } : {}),
      },
    };
    const data = await call<GenerateResponse>(this.apiKey, `models/${encodeURIComponent(this.model)}:generateContent`, { method: "POST", body: JSON.stringify(body) });
    if (data.promptFeedback?.blockReason) throw new AppError("UPSTREAM_ERROR", `Gemini declined to complete this request (${data.promptFeedback.blockReason}). Nothing was saved.`);
    const cand = data.candidates?.[0];
    const finish = cand?.finishReason ?? "";
    if (["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finish)) throw new AppError("UPSTREAM_ERROR", `Gemini declined to complete this request (${finish}). Nothing was saved.`);
    if (finish === "MAX_TOKENS") throw new AppError("MALFORMED_RESPONSE", "The AI response was cut off (length limit). Nothing was saved; try a shorter request.");
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();
    const u = data.usageMetadata ?? {};
    const usage: Usage = { input_tokens: u.promptTokenCount ?? 0, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
    return { text, usage };
  }

  async json<S extends z.ZodType>(req: AiJsonRequest<S>): Promise<{ value: z.infer<S>; usage: Usage }> {
    const schema = jsonSchemaFor(req.schema);
    let out: Awaited<ReturnType<GeminiProvider["generate"]>>;
    try {
      out = await this.generate(req.system, req.prompt, req.maxTokens ?? 16000, { schema });
    } catch (e) {
      // Some schema features aren't supported by every model; retry with the schema described in the prompt.
      if (!(e instanceof AppError && e.code === "UPSTREAM_ERROR" && /rejected the request/.test(e.message))) throw e;
      out = await this.generate(req.system, req.prompt, req.maxTokens ?? 16000, { schema, inPrompt: true });
    }
    const raw = out.text.replace(/^```(?:json)?\s*|\s*```$/g, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError("MALFORMED_RESPONSE", "The AI response could not be parsed. Nothing was saved; please retry.");
    }
    const checked = req.schema.safeParse(parsed);
    if (!checked.success) throw new AppError("MALFORMED_RESPONSE", "The AI response did not match the expected format. Nothing was saved; please retry.");
    return { value: checked.data as z.infer<S>, usage: out.usage };
  }

  async text(req: AiTextRequest): Promise<{ value: string; usage: Usage }> {
    const out = await this.generate(req.system, req.prompt, req.maxTokens ?? 64000);
    if (!out.text) throw new AppError("MALFORMED_RESPONSE", "The AI returned an empty response. Nothing was saved; please retry.");
    return { value: out.text, usage: out.usage };
  }
}

/** Lightweight connection test: lists the models the key can use. */
export async function testGeminiKey(apiKey: string) {
  try {
    await call(apiKey, "models?pageSize=1", { method: "GET", timeoutMs: 30_000 });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof AppError ? e.message : String(e) };
  }
}
