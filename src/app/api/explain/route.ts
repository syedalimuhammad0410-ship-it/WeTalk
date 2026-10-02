import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { getInvestigation } from "@/lib/server/investigations";
import { providerContext } from "@/lib/server/settings";
import { aiProvider } from "@/lib/providers/ai";
import { digest } from "@/lib/server/agent";

/** AI explanation of the current evidence (only from stored facts). Falls back to the rules-based explanation. */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, z.object({ investigationId: z.string().max(64) }));
  const inv = await getInvestigation(user.email, b.investigationId);
  const ai = aiProvider(await providerContext(user.email));
  if (!ai.configured()) return { status: "not_configured", explanation: inv.conclusion?.explanation, nextSteps: inv.conclusion?.nextSteps };
  try {
    const r = await ai.explainEvidence(digest(inv));
    return { status: "ok", model: ai.model, ...r };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e), explanation: inv.conclusion?.explanation, nextSteps: inv.conclusion?.nextSteps };
  }
}, { limit: 20, name: "explain" });
