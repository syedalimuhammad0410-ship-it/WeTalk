import "../guard";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { db } from "../../db";
import { AppError } from "../errors";
import { markIntegration, resolveIntegrationKey } from "../workspace";

/**
 * Thin, testable abstraction over the Claude API. All AI features go through
 * `getAi(workspaceId)`, which returns null when no key is configured so callers
 * can show "Connect Anthropic to enable this feature" instead of faking output.
 */
export type AiJsonRequest<S extends z.ZodType> = {
  feature: string;
  system: string;
  prompt: string;
  schema: S;
  maxTokens?: number;
};
export type AiTextRequest = { feature: string; system: string; prompt: string; maxTokens?: number };

export interface AiProvider {
  readonly model: string;
  json<S extends z.ZodType>(req: AiJsonRequest<S>): Promise<z.infer<S>>;
  text(req: AiTextRequest): Promise<string>;
}

type Factory = (workspaceId: string) => Promise<AiProvider | null>;
let testFactory: Factory | null = null;
/** Test hook: replace the provider factory (pass null to restore). */
export function setAiFactoryForTests(f: Factory | null) {
  testFactory = f;
}

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

export async function getAi(workspaceId: string): Promise<AiProvider | null> {
  if (testFactory) return testFactory(workspaceId);
  const key = await resolveIntegrationKey(workspaceId, "ANTHROPIC");
  if (!key) return null;
  const settings = await db.automationSettings.findUnique({ where: { workspaceId } });
  return new AnthropicProvider(workspaceId, key.key, settings?.aiModel || "claude-opus-5-5", settings?.aiEffort || "medium", key.source);
}

export async function requireAi(workspaceId: string, featureLabel: string) {
  const ai = await getAi(workspaceId);
  if (!ai) throw new AppError("NOT_CONFIGURED", `Connect an Anthropic API key in Settings → Integrations to enable ${featureLabel}.`);
  return ai;
}

class AnthropicProvider implements AiProvider {
  private client: Anthropic;
  constructor(
    private workspaceId: string,
    apiKey: string,
    readonly model: string,
    private effort: string,
    private keySource: "workspace" | "server",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  private base(maxTokens: number) {
    const supportsFallback = FALLBACK_MODELS.has(this.model);
    const isHaiku = this.model.startsWith("claude-haiku");
    return {
      model: this.model,
      max_tokens: maxTokens,
      ...(isHaiku ? {} : { thinking: { type: "adaptive" as const } }),
      ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }

  private outputConfig(extra: Record<string, unknown> = {}) {
    const isHaiku = this.model.startsWith("claude-haiku");
    return isHaiku ? extra : { effort: this.effort as "low" | "medium" | "high" | "xhigh" | "max", ...extra };
  }

  async json<S extends z.ZodType>(req: AiJsonRequest<S>): Promise<z.infer<S>> {
    return this.track(req.feature, async () => {
      const msg = await this.client.beta.messages.parse({
        ...this.base(req.maxTokens ?? 16000),
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: this.outputConfig({ format: betaZodOutputFormat(req.schema) }),
      } as Parameters<typeof this.client.beta.messages.parse>[0]);
      this.checkStop(msg.stop_reason);
      if (msg.parsed_output == null) throw new AppError("MALFORMED_RESPONSE", "The AI response could not be parsed. Nothing was saved; please retry.");
      return { value: msg.parsed_output as z.infer<S>, usage: msg.usage };
    });
  }

  async text(req: AiTextRequest): Promise<string> {
    return this.track(req.feature, async () => {
      const stream = this.client.beta.messages.stream({
        ...this.base(req.maxTokens ?? 64000),
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: this.outputConfig(),
      } as Parameters<typeof this.client.beta.messages.stream>[0]);
      const msg = await stream.finalMessage();
      this.checkStop(msg.stop_reason);
      const text = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (!text) throw new AppError("MALFORMED_RESPONSE", "The AI returned an empty response. Nothing was saved; please retry.");
      return { value: text, usage: msg.usage };
    });
  }

  private checkStop(stop: string | null) {
    if (stop === "refusal") throw new AppError("UPSTREAM_ERROR", "The AI declined to complete this request. Nothing was saved.");
    if (stop === "max_tokens") throw new AppError("MALFORMED_RESPONSE", "The AI response was cut off (length limit). Nothing was saved; try a shorter request.");
  }

  private async track<T>(feature: string, fn: () => Promise<{ value: T; usage: { input_tokens: number; output_tokens: number } }>): Promise<T> {
    try {
      const { value, usage } = await fn();
      await db.aiUsage.create({
        data: { workspaceId: this.workspaceId, feature, model: this.model, inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 },
      });
      if (this.keySource === "workspace") await markIntegration(this.workspaceId, "ANTHROPIC", true);
      return value;
    } catch (e) {
      const mapped = mapAnthropicError(e);
      await db.aiUsage
        .create({ data: { workspaceId: this.workspaceId, feature, model: this.model, success: false, error: mapped.message.slice(0, 500) } })
        .catch(() => {});
      if (mapped.code === "INVALID_CREDENTIALS" || mapped.code === "QUOTA_EXCEEDED") {
        await markIntegration(this.workspaceId, "ANTHROPIC", false, mapped.message);
      }
      throw mapped;
    }
  }
}

export function mapAnthropicError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AppError("INVALID_CREDENTIALS", "Anthropic rejected the API key. Update it in Settings → Integrations.");
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new AppError("RATE_LIMITED", "Anthropic rate limit reached. Nothing was changed; retry in a minute.");
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new AppError("NOT_CONFIGURED", "The selected AI model is not available for this API key. Choose another model in Settings → AI.");
  }
  if (e instanceof Anthropic.BadRequestError) {
    const msg = e.message || "";
    if (/credit balance|billing|quota/i.test(msg)) return new AppError("QUOTA_EXCEEDED", "Anthropic account quota or credit exhausted. Nothing was generated.");
    return new AppError("UPSTREAM_ERROR", `Anthropic rejected the request: ${msg.slice(0, 200)}`);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AppError("UPSTREAM_TIMEOUT", "Anthropic did not respond in time. Nothing was saved; please retry.");
  if (e instanceof Anthropic.APIConnectionError) return new AppError("NETWORK", "Could not reach Anthropic (network error). Nothing was saved.");
  if (e instanceof Anthropic.InternalServerError) return new AppError("UPSTREAM_ERROR", "Anthropic is temporarily unavailable. Nothing was saved; retry shortly.");
  if (e instanceof Anthropic.APIError) return new AppError("UPSTREAM_ERROR", `Anthropic error ${e.status ?? ""}: ${e.message.slice(0, 200)}`);
  return new AppError("INTERNAL", `AI request failed: ${(e as Error)?.message ?? String(e)}`);
}

/** Lightweight connection test used by onboarding and System Health. */
export async function testAnthropicKey(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30000 });
  try {
    await client.models.retrieve(model);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: mapAnthropicError(e).message };
  }
}
