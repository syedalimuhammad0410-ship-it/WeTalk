import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { sendEmail } from "@/lib/server/email/send";

/** Manual (human-written) reply in an existing conversation. */
export const POST = api({ permission: "emails.send" }, async (req, ctx, p) => {
  const conv = await db.conversation.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!conv) throw new AppError("NOT_FOUND", "Conversation not found.");
  const b = await parseBody(req, z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20000) }));
  const r = await sendEmail({ workspaceId: ctx.workspace.id, userId: ctx.user.id, to: conv.counterpartEmail, subject: b.subject, body: b.body, kind: "REPLY", businessId: conv.businessId, conversationId: conv.id });
  await db.aiResponseDraft.updateMany({ where: { conversationId: conv.id, status: "PENDING" }, data: { status: "SUPERSEDED" } });
  await db.conversation.update({ where: { id: conv.id }, data: { needsHumanReview: false, reviewReason: null } });
  return { messageId: r.message.id, sandbox: r.sandbox };
});
