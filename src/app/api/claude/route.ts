import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { commandCentre, resumeEverything, stopEverything } from "@/lib/server/claude/centre";

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => commandCentre(ctx.workspace.id));

/** Emergency stop / resume everything. */
export const POST = api({ permission: "automation.manage" }, async (req, ctx) => {
  const b = await parseBody(req, z.object({ action: z.enum(["stop", "resume"]) }));
  if (b.action === "stop") await stopEverything(ctx.workspace.id, ctx.user.id);
  else await resumeEverything(ctx.workspace.id, ctx.user.id);
  return commandCentre(ctx.workspace.id);
});
