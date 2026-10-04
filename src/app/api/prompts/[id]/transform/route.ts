import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { transformPrompt } from "@/lib/server/prompts/service";

export const POST = api({ permission: "prompts.edit" }, async (req, ctx, p) => {
  const b = await parseBody(req, z.object({ op: z.enum(["IMPROVE", "SHORTEN", "EXPAND", "ADD_FEATURE", "REMOVE_FEATURE"]), feature: z.string().optional() }));
  const r = await transformPrompt(ctx.workspace.id, p.id!, b.op, ctx.user.id, b.feature);
  return { version: r.version, quality: r.quality.score, notes: r.notes };
});
export const maxDuration = 300;
