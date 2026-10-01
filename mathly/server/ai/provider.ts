// Server-side AI layer. API keys never leave the server. The provider is isolated behind this
// module so it can be swapped (set AI_PROVIDER=none to run fully on the built-in engines).
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessageParam, BetaTool, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { config } from '../config.ts';

export class AIUnavailable extends Error {}
export const aiConfigured = () => config.ai.configured;

let client: Anthropic | null = null;
function getClient() {
  if (!config.ai.configured) throw new AIUnavailable('AI provider not configured');
  // Credentials are resolved by the SDK from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN.
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 });
  return client;
}

export type Effort = 'low' | 'medium' | 'high';
export interface ChatOptions {
  system: string;
  messages: BetaMessageParam[];
  maxTokens?: number;
  effort?: Effort;
  tools?: BetaTool[];
  /** Executes a client tool call and returns its text result (used for the verified-calculator tool). */
  runTool?: (name: string, input: Record<string, unknown>) => Promise<string> | string;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

async function create(opts: ChatOptions & { format?: Record<string, unknown> }) {
  const c = getClient();
  const res = await c.beta.messages.create({
    model: config.ai.model,
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    output_config: { effort: opts.effort ?? 'low', ...(opts.format ? { format: { type: 'json_schema', schema: opts.format } } : {}) },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });
  if (res.stop_reason === 'refusal') throw new AIUnavailable('The AI declined this request.');
  return res;
}

/** Text completion with an optional client-side tool loop (bounded). */
export async function aiText(opts: ChatOptions): Promise<string> {
  const messages = [...opts.messages];
  for (let turn = 0; turn < 5; turn++) {
    const res = await create({ ...opts, messages });
    if (res.stop_reason === 'tool_use' && opts.runTool) {
      messages.push({ role: 'assistant', content: res.content as BetaContentBlockParam[] });
      const results: BetaToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        let out: string; let isError = false;
        try { out = await opts.runTool(block.name, (block.input ?? {}) as Record<string, unknown>); } catch (e) { out = (e as Error).message; isError = true; }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: out, is_error: isError });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    return res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
  }
  throw new AIUnavailable('The tutor took too many steps.');
}

/** Structured JSON output constrained by a JSON schema. */
export async function aiJSON<T>(opts: ChatOptions & { schema: Record<string, unknown> }): Promise<T> {
  const res = await create({ ...opts, format: opts.schema, effort: opts.effort ?? 'medium', maxTokens: opts.maxTokens ?? 16000 });
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  try { return JSON.parse(text) as T; } catch { throw new AIUnavailable('The AI returned an unreadable response.'); }
}

export function imageBlock(base64: string, mediaType: string): BetaContentBlockParam {
  if (mediaType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  return { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png', data: base64 } };
}

// JSON-schema helpers for strict structured outputs (all properties required, no extras).
export const S = {
  obj: (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false }),
  str: (description?: string) => ({ type: 'string', ...(description ? { description } : {}) }),
  num: (description?: string) => ({ type: 'number', ...(description ? { description } : {}) }),
  int: (description?: string) => ({ type: 'integer', ...(description ? { description } : {}) }),
  bool: () => ({ type: 'boolean' }),
  arr: (items: unknown, description?: string) => ({ type: 'array', items, ...(description ? { description } : {}) }),
  enm: (values: string[]) => ({ type: 'string', enum: values }),
};
