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
// Fallback only; the newest stable "gemini-X-flash" the key can use is detected automatically.
const DEFAULT_MODEL = "gemini-3.8-flash";
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
  exhausted.clear();
}

/** Transient "busy"/rate-limit responses are retried with backoff (Gemini's free tier often returns 503 under load). */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
let retryDelays = [1500, 4000, 9000];
/** Test hook: shorten retry waits. */
export function setGeminiRetryDelaysForTests(d: number[] | null) {
  retryDelays = d ?? [1500, 4000, 9000];
}

async function call<T>(apiKey: string, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(`${API}/${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(init.timeoutMs ?? 10 * 60_000),
      });
    } catch (e) {
      if ((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") throw new AppError("UPSTREAM_TIMEOUT", "Gemini did not respond in time. Nothing was saved; please retry.");
      if (attempt < retryDelays.length) {
        await new Promise((r) => setTimeout(r, retryDelays[attempt]));
        continue;
      }
      throw new AppError("NETWORK", "Could not reach Google Gemini (network error). Nothing was saved.");
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: GeminiErrorBody };
    if (res.ok) return data;
    const limit = res.status === 429 ? rateLimitInfo(data.error) : null;
    if (limit?.daily) throw new ModelLimitError("daily", limit.retryMs, mapGeminiError(429, data.error?.message ?? "", "DAILY_QUOTA").message);
    if (res.status === 404 && /no longer available|not found for API version|is not supported/i.test(data.error?.message ?? "")) throw new ModelLimitError("retired", null, mapGeminiError(404, data.error?.message ?? "").message);
    // Per-minute limits: let the caller switch to another model (or wait) instead of retrying here.
    if (limit) throw new ModelLimitError("minute", limit.retryMs, mapGeminiError(429, data.error?.message ?? "", "RATE_LIMIT").message);
    if (RETRY_STATUS.has(res.status) && attempt < retryDelays.length) {
      const header = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(header) && header > 0 ? Math.min(header * 1000, 20_000) : retryDelays[attempt]!));
      continue;
    }
    throw mapGeminiError(res.status, data.error?.message ?? "", data.error?.status ?? "");
  }
}

/** A per-model limit: the next model may still work. */
class ModelLimitError extends AppError {
  constructor(
    readonly kind: "daily" | "minute" | "retired",
    readonly retryMs: number | null,
    message: string,
  ) {
    super(kind === "daily" ? "QUOTA_EXCEEDED" : kind === "retired" ? "NOT_CONFIGURED" : "RATE_LIMITED", message);
  }
}

type GeminiErrorBody = { message?: string; status?: string; details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string; quotaMetric?: string }[] }[] };

/** Reads Google's QuotaFailure / RetryInfo details: is it a daily cap, and how long to wait? */
export function rateLimitInfo(err: GeminiErrorBody | undefined) {
  const details = err?.details ?? [];
  const ids = details.flatMap((d) => d.violations ?? []).map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`).join(" ");
  const daily = /per ?day|PerDay/i.test(ids) || /per day|daily/i.test(err?.message ?? "");
  const delay = details.find((d) => d.retryDelay)?.retryDelay ?? /retry in ([\d.]+)s/i.exec(err?.message ?? "")?.[1];
  const secs = delay ? parseFloat(String(delay)) : NaN;
  return { daily, retryMs: Number.isFinite(secs) ? Math.ceil(secs * 1000) + 500 : null };
}

export function mapGeminiError(status: number, message: string, code = ""): AppError {
  const msg = message.slice(0, 300);
  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(message) || status === 401) return new AppError("INVALID_CREDENTIALS", "Google rejected the Gemini API key. Update it in Settings → Integrations.");
  if (status === 403) return new AppError("INVALID_CREDENTIALS", `Gemini API access denied — check that the “Generative Language API” is enabled for this key's project. (${msg})`);
  if (code === "DAILY_QUOTA") return new AppError("QUOTA_EXCEEDED", "Today's free Gemini quota for this key is used up. It resets daily — or enable billing on the key at aistudio.google.com for higher limits. Nothing was generated.");
  if (status === 429 || code === "RESOURCE_EXHAUSTED") {
    // Per-minute limits are temporary: don't treat the key as broken.
    return new AppError("RATE_LIMITED", "Gemini is busy (free-tier requests-per-minute limit). Nothing was changed; try again in a minute.");
  }
  if (status === 404) return new AppError("NOT_CONFIGURED", `The Gemini model isn't available for this key. (${msg})`);
  if (status === 400) return new AppError("UPSTREAM_ERROR", `Gemini rejected the request: ${msg}`);
  if (status >= 500) return new AppError("UPSTREAM_ERROR", `Google Gemini is temporarily unavailable. Nothing was saved; retry shortly.${msg ? ` (${status}: ${msg})` : ""}`);
  return new AppError("UPSTREAM_ERROR", `Gemini error ${status}: ${msg}`);
}

const modelCache = new Map<string, { models: string[]; at: number }>();
/** Models that hit a limit for a key, until the given time (daily free quotas are per model). */
const exhausted = new Map<string, number>();
const keyHash = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex");
const isExhausted = (apiKey: string, model: string) => (exhausted.get(`${keyHash(apiKey)}:${model}`) ?? 0) > Date.now();

/**
 * Stable text models the key can use, best first: newest "gemini-X-flash", then older
 * Flash versions, then "gemini-X-flash-lite". Each model has its own free-tier quota, so
 * when one is used up the next one takes over. Cached for an hour.
 */
export async function resolveGeminiModels(apiKey: string, preferred?: string | null): Promise<string[]> {
  const cacheKey = keyHash(apiKey);
  const hit = modelCache.get(cacheKey);
  let models: string[];
  if (hit && Date.now() - hit.at < 3_600_000) models = hit.models;
  else {
    models = [];
    try {
      const data = await call<{ models?: { name: string; supportedGenerationMethods?: string[] }[] }>(apiKey, "models?pageSize=1000", { method: "GET", timeoutMs: 20_000 });
      const usable = (data.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
      const pick = (re: RegExp) => usable.map((n) => re.exec(n)).filter((m): m is RegExpExecArray => Boolean(m)).sort((a, b) => Number(b[1]) - Number(a[1])).map((m) => m[0]);
      models = [...pick(/^gemini-(\d+(?:\.\d+)?)-flash$/), ...pick(/^gemini-(\d+(?:\.\d+)?)-flash-lite$/)];
    } catch {
      /* fall back to the default model; the generate call reports real errors */
    }
    if (!models.length) models = [DEFAULT_MODEL];
    modelCache.set(cacheKey, { models, at: Date.now() });
  }
  return preferred && preferred.startsWith("gemini") ? [preferred, ...models.filter((m) => m !== preferred)] : models;
}

/** The model that will be tried first (skips models currently out of quota). */
export async function resolveGeminiModel(apiKey: string, preferred?: string | null): Promise<string> {
  const models = await resolveGeminiModels(apiKey, preferred);
  return models.find((m) => !isExhausted(apiKey, m)) ?? models[0]!;
}

/** Gemini's structured output accepts a JSON-Schema subset; drop the meta keyword it doesn't need. */
function jsonSchemaFor(schema: z.ZodType) {
  const js = toJSONSchema(schema as never) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export class GeminiProvider {
  private models: string[];
  /** The model used for the most recent request. */
  model: string;
  constructor(
    private apiKey: string,
    models: string | string[],
  ) {
    this.models = Array.isArray(models) ? models : [models];
    this.model = this.models[0]!;
  }

  /** Tries each model in order, moving on when one is out of quota, busy or retired. */
  private async generate(system: string, prompt: string, maxTokens: number, json?: { schema: Record<string, unknown>; inPrompt?: boolean }) {
    let lastError: unknown = null;
    for (let round = 0; round < 2; round++) {
      const candidates = this.models.filter((m) => !isExhausted(this.apiKey, m));
      const minuteWaits: number[] = [];
      for (const model of candidates) {
        try {
          const r = await this.generateWith(model, system, prompt, maxTokens, json);
          this.model = model;
          return r;
        } catch (e) {
          if (!(e instanceof ModelLimitError)) throw e;
          lastError = e;
          if (e.kind === "minute") minuteWaits.push(e.retryMs ?? retryDelays[retryDelays.length - 1]!);
          else exhausted.set(`${keyHash(this.apiKey)}:${model}`, Date.now() + (e.kind === "daily" ? e.retryMs ?? 86_400_000 : 7 * 86_400_000));
        }
      }
      // Every remaining model is only briefly rate-limited: wait once (bounded), then try again.
      if (!minuteWaits.length || round === 1) break;
      await new Promise((r) => setTimeout(r, Math.min(Math.min(...minuteWaits), 45_000)));
    }
    if (lastError instanceof ModelLimitError && lastError.kind === "daily")
      throw new AppError("QUOTA_EXCEEDED", "Today's free Gemini quota is used up on every available model for this key. It resets daily — or turn on billing for the key at aistudio.google.com for much higher limits. Nothing was generated.");
    throw lastError instanceof AppError ? new AppError(lastError.code, lastError.message) : new AppError("UPSTREAM_ERROR", "Gemini is unavailable right now. Nothing was saved; try again shortly.");
  }

  private async generateWith(model: string, system: string, prompt: string, maxTokens: number, json?: { schema: Record<string, unknown>; inPrompt?: boolean }) {
    const userText = json?.inPrompt ? `${prompt}\n\nRespond with ONLY a JSON object (no markdown fences) that matches this JSON Schema:\n${JSON.stringify(json.schema)}` : prompt;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: Math.min(maxTokens, MAX_OUTPUT),
        ...(json ? { responseMimeType: "application/json", ...(json.inPrompt ? {} : { responseJsonSchema: json.schema }) } : {}),
      },
    };
    const data = await call<GenerateResponse>(this.apiKey, `models/${encodeURIComponent(model)}:generateContent`, { method: "POST", body: JSON.stringify(body) });
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
