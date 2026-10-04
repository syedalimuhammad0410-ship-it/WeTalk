import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";

export const DELETE = api({ permission: "leads.delete" }, async (req, ctx, p) => {
  const c = await db.conversation.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!c) throw new AppError("NOT_FOUND", "Conversation not found.");
  await parseBody(req, z.object({ confirm: z.literal(true) }));
  await db.conversation.delete({ where: { id: c.id } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, businessId: c.businessId, action: "conversation.deleted", summary: `Conversation with ${c.counterpartEmail} deleted` });
  return { ok: true };
});
