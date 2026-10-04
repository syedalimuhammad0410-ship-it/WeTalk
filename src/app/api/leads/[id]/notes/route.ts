import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { getLeadOrThrow } from "@/lib/server/leads";
import { logActivity } from "@/lib/server/activity";

export const POST = api({ permission: "leads.edit" }, async (req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const { body } = await parseBody(req, z.object({ body: z.string().trim().min(1, "Note cannot be empty").max(5000) }));
  const note = await db.note.create({ data: { workspaceId: ctx.workspace.id, businessId: lead.id, authorId: ctx.user.id, body } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, businessId: lead.id, action: "note.added", summary: "Note added" });
  return note;
});
