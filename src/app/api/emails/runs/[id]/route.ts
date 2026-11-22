import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { controlEmailRun, emailRunState } from "@/lib/server/email/runs";

export const GET = api({ permission: "leads.view" }, async (req, ctx, p) => emailRunState(ctx.workspace.id, p.id!, new URL(req.url).searchParams.get("item")));

export const PATCH = api({ permission: "emails.send" }, async (req, ctx, p) => {
  const b = await parseBody(req, z.object({ action: z.enum(["pause", "resume", "cancel"]) }));
  return controlEmailRun(ctx.workspace.id, p.id!, b.action);
});
