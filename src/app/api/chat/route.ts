import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { getInvestigation } from "@/lib/server/investigations";
import { providerContext } from "@/lib/server/settings";
import { runAgent, runGeminiAgent } from "@/lib/server/agent";
import { answer } from "@/lib/engine/intents";

const PRIVACY = /\b(who is (this|that|the) (person|man|woman|guy|girl)|identify (this|the) (person|face|man|woman)|face ?recogni|where does (he|she|this person) live|home address of|track (him|her|this person)|dox)\b/i;

/** TRACE AI: LLM agent with real tools when configured; deterministic intent engine otherwise. */
export const POST = route(async (req, { user }) => {
  const body = await readJson(req, z.object({ investigationId: z.string().max(64), message: z.string().min(1).max(4000) }));
  const inv = await getInvestigation(user.email, body.investigationId);
  if (PRIVACY.test(body.message)) {
    return {
      reply: "I can't identify private individuals, find where someone lives, or track people. TRACE is built for researching public places, venues, buildings, organizations, objects and documents. I can keep working on the location or other non-personal clues in this image.",
      actions: [],
      engine: "policy",
    };
  }
  const ctx = await providerContext(user.email);
  try {
    const r = await runAgent(ctx, inv, body.message);
    if (r) return { ...r, engine: `anthropic:${ctx.prefs.aiModel}` };
    const g = await runGeminiAgent(ctx, inv, body.message);
    if (g) return { ...g, engine: `gemini:${g.model}` };
  } catch (e) {
    const fallback = answer(inv, body.message);
    return { ...fallback, engine: "rules", warning: `AI assistant unavailable (${e instanceof Error ? e.message : String(e)}); answered from investigation state.` };
  }
  return { ...answer(inv, body.message), engine: "rules" };
}, { limit: 30, name: "chat" });
