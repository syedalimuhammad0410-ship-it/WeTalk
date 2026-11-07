import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { controlAutoProspect, getAutoProspect } from "@/lib/server/automation/autoprospect";

export const GET = api({ permission: "leads.view" }, async (_req, ctx, p) => getAutoProspect(ctx.workspace.id, p.id!));

const Body = z.object({
  action: z.enum(["pause", "resume", "cancel", "retry_failed", "continue"]),
  addTarget: z.coerce.number().int().min(0).max(20000).optional(),
  addRequests: z.coerce.number().int().min(0).max(50000).optional(),
});

export const PATCH = api({ permission: "campaigns.manage" }, async (req, ctx, p) => {
  const b = await parseBody(req, Body);
  await controlAutoProspect(ctx.workspace.id, p.id!, b.action, b);
  return { ok: true };
});
