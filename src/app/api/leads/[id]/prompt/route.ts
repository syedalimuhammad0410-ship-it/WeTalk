import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { getLeadOrThrow } from "@/lib/server/leads";
import { generatePrompt } from "@/lib/server/prompts/service";

export const POST = api({ permission: "prompts.edit" }, async (req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const opts = await parseBody(req, z.object({ detail: z.enum(["concise", "standard", "detailed"]).optional() }).default({})).catch(() => ({}));
  const r = await generatePrompt(ctx.workspace.id, lead.id, ctx.user.id, opts);
  return { promptId: r.promptId, version: r.version, quality: r.quality.score, notes: r.notes };
});
export const maxDuration = 300;
