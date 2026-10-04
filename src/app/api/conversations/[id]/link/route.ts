import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";

/** Manually links an unmatched conversation to a lead. */
export const POST = api({ permission: "leads.edit" }, async (req, ctx, p) => {
  const { businessId } = await parseBody(req, z.object({ businessId: z.string() }));
  const [conv, lead] = await Promise.all([
    db.conversation.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } }),
    db.business.findFirst({ where: { id: businessId, workspaceId: ctx.workspace.id } }),
  ]);
  if (!conv || !lead) throw new AppError("NOT_FOUND", "Conversation or lead not found.");
  await db.$transaction([
    db.conversation.update({ where: { id: conv.id }, data: { businessId: lead.id, reviewReason: conv.reviewReason === "Sender could not be matched to a lead" ? null : conv.reviewReason } }),
    db.emailMessage.updateMany({ where: { conversationId: conv.id }, data: { businessId: lead.id } }),
    db.aiResponseDraft.updateMany({ where: { conversationId: conv.id }, data: { businessId: lead.id } }),
  ]);
  if (!(await db.contact.findFirst({ where: { businessId: lead.id, email: conv.counterpartEmail } }))) {
    await db.contact.create({ data: { workspaceId: ctx.workspace.id, businessId: lead.id, email: conv.counterpartEmail, source: "Replied to outreach" } });
  }
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, businessId: lead.id, action: "conversation.linked", summary: `Conversation with ${conv.counterpartEmail} linked to this lead` });
  return { ok: true };
});
