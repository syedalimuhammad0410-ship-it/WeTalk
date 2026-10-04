import "../guard";
import { db } from "../../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";
import { changeLeadStatus } from "../leads";
import { sendEmail } from "../email/send";

export async function approveDraft(workspaceId: string, draftId: string, userId: string, edits?: { subject?: string; body?: string }) {
  const draft = await db.aiResponseDraft.findFirst({ where: { id: draftId, workspaceId }, include: { conversation: true } });
  if (!draft) throw new AppError("NOT_FOUND", "Draft not found.");
  if (draft.status !== "PENDING") throw new AppError("CONFLICT", `This draft is already ${draft.status.toLowerCase().replace("_", " ")}.`);
  const edited = Boolean(edits?.body && edits.body.trim() !== draft.body.trim());
  const sent = await sendEmail({
    workspaceId,
    userId,
    to: draft.conversation.counterpartEmail,
    subject: edits?.subject?.trim() || draft.subject,
    body: edits?.body?.trim() || draft.body,
    kind: "AI_REPLY",
    businessId: draft.businessId,
    conversationId: draft.conversationId,
    aiGenerated: true,
  });
  await db.aiResponseDraft.update({ where: { id: draft.id }, data: { status: "SENT", decidedById: userId, decidedAt: new Date(), sentMessageId: sent.message.id, ...(edited ? { body: edits!.body!.trim() } : {}) } });
  await db.conversation.update({ where: { id: draft.conversationId }, data: { needsHumanReview: false, reviewReason: null, unread: false } });
  await logActivity({ workspaceId, userId, businessId: draft.businessId, action: "ai.response_approved", summary: `AI response ${edited ? "edited, " : ""}approved and sent` });
  if (draft.businessId) {
    const b = await db.business.findUnique({ where: { id: draft.businessId } });
    if (b?.status === "AI_RESPONSE_READY") await changeLeadStatus({ workspaceId, businessId: b.id, to: ["INTERESTED", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL", "PRICING"].includes(draft.intent) ? "INTERESTED" : "RESPONDED", userId, reason: "Reply sent" });
  }
  return sent;
}

export async function rejectDraft(workspaceId: string, draftId: string, userId: string) {
  const draft = await db.aiResponseDraft.findFirst({ where: { id: draftId, workspaceId } });
  if (!draft) throw new AppError("NOT_FOUND", "Draft not found.");
  if (draft.status !== "PENDING") throw new AppError("CONFLICT", "This draft is no longer pending.");
  await db.aiResponseDraft.update({ where: { id: draftId }, data: { status: "REJECTED", decidedById: userId, decidedAt: new Date() } });
  await logActivity({ workspaceId, userId, businessId: draft.businessId, action: "ai.response_rejected", summary: "AI response draft rejected" });
}

export async function setConversationControl(workspaceId: string, conversationId: string, userId: string, action: "PAUSE_AI" | "RESUME_AI" | "TAKE_OVER" | "RELEASE" | "DO_NOT_CONTACT" | "MARK_READ" | "CLOSE" | "REOPEN") {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId } });
  if (!conv) throw new AppError("NOT_FOUND", "Conversation not found.");
  const bid = conv.businessId;
  switch (action) {
    case "MARK_READ":
      await db.conversation.update({ where: { id: conv.id }, data: { unread: false } });
      return;
    case "CLOSE":
    case "REOPEN":
      await db.conversation.update({ where: { id: conv.id }, data: { isOpen: action === "REOPEN" } });
      break;
    case "PAUSE_AI":
    case "RESUME_AI":
      if (!bid) throw new AppError("VALIDATION", "Link this conversation to a lead first.");
      await db.business.update({ where: { id: bid }, data: { aiPaused: action === "PAUSE_AI" } });
      if (action === "PAUSE_AI") await db.aiResponseDraft.updateMany({ where: { conversationId: conv.id, status: "PENDING" }, data: { requiresReview: true } });
      break;
    case "TAKE_OVER":
    case "RELEASE":
      if (!bid) throw new AppError("VALIDATION", "Link this conversation to a lead first.");
      await db.business.update({ where: { id: bid }, data: { humanTakeover: action === "TAKE_OVER", ...(action === "TAKE_OVER" ? { assignedToId: userId } : {}) } });
      await db.conversation.update({ where: { id: conv.id }, data: { assignedToId: action === "TAKE_OVER" ? userId : conv.assignedToId } });
      break;
    case "DO_NOT_CONTACT":
      if (bid) await changeLeadStatus({ workspaceId, businessId: bid, to: "DO_NOT_CONTACT", userId, reason: "Marked Do Not Contact from conversation" });
      await db.suppressionEntry.upsert({ where: { workspaceId_value: { workspaceId, value: conv.counterpartEmail } }, create: { workspaceId, value: conv.counterpartEmail, reason: "Marked Do Not Contact" }, update: {} });
      break;
  }
  await logActivity({ workspaceId, userId, businessId: bid, action: `conversation.${action.toLowerCase()}`, summary: { PAUSE_AI: "AI paused", RESUME_AI: "AI resumed", TAKE_OVER: "Conversation taken over by a human", RELEASE: "Conversation released back to AI", DO_NOT_CONTACT: "Marked Do Not Contact", CLOSE: "Conversation closed", REOPEN: "Conversation reopened", MARK_READ: "" }[action] });
}
