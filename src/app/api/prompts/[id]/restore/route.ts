import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { restorePromptVersion } from "@/lib/server/prompts/service";

export const POST = api({ permission: "prompts.edit" }, async (req, ctx, p) => {
  const { version } = await parseBody(req, z.object({ version: z.number().int().min(1) }));
  return restorePromptVersion(ctx.workspace.id, p.id!, version, ctx.user.id);
});
