import "./guard";
import type { FollowUp } from "@prisma/client";
import { db } from "../db";
import { AppError, describeError } from "./errors";
import { logActivity, notify } from "./activity";
import { getSettings } from "./workspace";
import { templateVarsFor } from "./email/compose";
import { renderTemplate } from "./email/templates";

const STOP_STATUSES = ["WON", "LOST", "DO_NOT_CONTACT", "INTERESTED", "MEETING", "PROPOSAL", "RESPONDED", "AI_RESPONSE_READY"];

/** Creates the follow-up schedule after initial outreach. Bounded by compliance.maxFollowUps. */
export async function scheduleFollowUps(workspaceId: string, businessId: string, conversationId: string, campaignId: string | null, sentAt: Date) {
  const { automation, compliance } = await getSettings(workspaceId);
  const campaign = campaignId ? await db.campaign.findFirst({ where: { id: campaignId, workspaceId } }) : null;
  const days = (campaign?.followUpDays?.length ? campaign.followUpDays : automation.followUpDays).filter((d) => d > 0).sort((a, b) => a - b);
  const steps = days.slice(0, compliance.maxFollowUps);
  const wantsAuto = campaign ? campaign.followUpMode === "AUTOMATIC" : true;
  const automatic = automation.automaticFollowUps && wantsAuto;
  await db.followUp.deleteMany({ where: { businessId, status: "SCHEDULED" } });
  if (!steps.length) return [];
  await db.followUp.createMany({
    data: steps.map((d, i) => ({ workspaceId, businessId, campaignId, conversationId, step: i + 1, scheduledFor: new Date(sentAt.getTime() + d * 86400_000), automatic })),
  });
  await logActivity({ workspaceId, businessId, action: "followup.scheduled", summary: `${steps.length} follow-up(s) scheduled (day ${steps.join(", day ")}; ${automatic ? "automatic" : "approval required"})` });
  return steps;
}

export async function cancelFollowUps(workspaceId: string, businessId: string, reason: string, userId?: string | null) {
  const r = await db.followUp.updateMany({ where: { workspaceId, businessId, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED", cancelReason: reason } });
  if (r.count) await logActivity({ workspaceId, userId, businessId, action: "followup.cancelled", summary: `${r.count} follow-up(s) stopped — ${reason}` });
  return r.count;
}

/** Why a follow-up must not go out (null = OK to proceed). */
export async function followUpStopReason(f: FollowUp): Promise<string | null> {
  const b = await db.business.findUnique({ where: { id: f.businessId } });
  if (!b) return "Lead deleted";
  if (b.doNotContact) return "Lead is marked Do Not Contact";
  if (b.archived) return "Lead archived";
  if (STOP_STATUSES.includes(b.status)) return `Lead status is ${b.status.replace(/_/g, " ").toLowerCase()}`;
  const replied = await db.emailMessage.findFirst({ where: { businessId: b.id, direction: "INBOUND" }, select: { id: true } });
  if (replied) return "Business replied";
  const { compliance } = await getSettings(f.workspaceId);
  const sent = await db.emailMessage.count({ where: { businessId: b.id, kind: "FOLLOW_UP", status: "SENT" } });
  if (sent >= compliance.maxFollowUps) return `Maximum follow-ups (${compliance.maxFollowUps}) reached`;
  if (f.campaignId) {
    const c = await db.campaign.findUnique({ where: { id: f.campaignId } });
    if (c && c.status === "PAUSED") return null; // paused: leave scheduled (handled by caller)
  }
  return null;
}

async function followUpContent(f: FollowUp) {
  const b = await db.business.findUniqueOrThrow({ where: { id: f.businessId } });
  const templates = await db.emailTemplate.findMany({ where: { workspaceId: f.workspaceId, kind: "FOLLOW_UP" }, orderBy: { createdAt: "asc" } });
  const tpl = templates[Math.min(f.step - 1, templates.length - 1)];
  if (!tpl) throw new AppError("NOT_FOUND", "No follow-up template exists. Create one in Templates.");
  const { vars } = await templateVarsFor(f.workspaceId, b);
  return { business: b, subject: renderTemplate(tpl.subject, vars).text, body: renderTemplate(tpl.body, vars).text };
}

/** Processes due follow-ups for all workspaces (or one). Safe to run repeatedly. */
export async function dispatchDueFollowUps(workspaceId?: string) {
  const due = await db.followUp.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() }, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });
  const result = { sent: 0, pendingApproval: 0, cancelled: 0, postponed: 0, failed: 0 };
  for (const f of due) {
    if (f.campaignId) {
      const c = await db.campaign.findUnique({ where: { id: f.campaignId } });
      if (c?.status === "PAUSED") continue;
    }
    const stop = await followUpStopReason(f);
    if (stop) {
      await db.followUp.update({ where: { id: f.id }, data: { status: "CANCELLED", cancelReason: stop } });
      result.cancelled++;
      continue;
    }
    const { automation } = await getSettings(f.workspaceId);
    let content;
    try {
      content = await followUpContent(f);
    } catch (e) {
      await db.followUp.update({ where: { id: f.id }, data: { status: "FAILED", cancelReason: describeError(e) } });
      result.failed++;
      continue;
    }
    if (!f.automatic || !automation.automaticFollowUps) {
      await db.followUp.update({ where: { id: f.id }, data: { status: "PENDING_APPROVAL", subject: content.subject, body: content.body } });
      await notify({ workspaceId: f.workspaceId, type: "FOLLOW_UP_DUE", title: `Follow-up due: ${content.business.name}`, body: `Step ${f.step} is ready for your approval.`, link: "/follow-ups" });
      result.pendingApproval++;
      continue;
    }
    if (!content.business.email) {
      await db.followUp.update({ where: { id: f.id }, data: { status: "FAILED", cancelReason: "Lead has no email address" } });
      result.failed++;
      continue;
    }
    try {
      const { sendEmail } = await import("./email/send");
      const sent = await sendEmail({ workspaceId: f.workspaceId, userId: null, to: content.business.email, subject: content.subject, body: content.body, kind: "FOLLOW_UP", businessId: f.businessId, conversationId: f.conversationId, campaignId: f.campaignId, automated: true });
      await db.followUp.update({ where: { id: f.id }, data: { status: "SENT", sentMessageId: sent.message.id, subject: content.subject, body: content.body } });
      result.sent++;
    } catch (e) {
      const err = e as AppError;
      if (err.code === "RATE_LIMITED") {
        await db.followUp.update({ where: { id: f.id }, data: { scheduledFor: new Date(Date.now() + 15 * 60_000) } });
        result.postponed++;
      } else {
        await db.followUp.update({ where: { id: f.id }, data: { status: err.code === "SUPPRESSED" ? "CANCELLED" : "FAILED", cancelReason: describeError(e).slice(0, 300) } });
        result.failed++;
      }
    }
  }
  return result;
}

export async function approveFollowUp(workspaceId: string, id: string, userId: string, edits?: { subject?: string; body?: string }) {
  const f = await db.followUp.findFirst({ where: { id, workspaceId } });
  if (!f) throw new AppError("NOT_FOUND", "Follow-up not found.");
  if (!["PENDING_APPROVAL", "SCHEDULED"].includes(f.status)) throw new AppError("CONFLICT", `This follow-up is already ${f.status.toLowerCase().replace("_", " ")}.`);
  const stop = await followUpStopReason(f);
  if (stop) {
    await db.followUp.update({ where: { id }, data: { status: "CANCELLED", cancelReason: stop } });
    throw new AppError("CONFLICT", `Follow-up cancelled: ${stop}.`);
  }
  const content = f.subject && f.body ? { subject: f.subject, body: f.body, business: await db.business.findUniqueOrThrow({ where: { id: f.businessId } }) } : await followUpContent(f);
  if (!content.business.email) throw new AppError("VALIDATION", "This lead has no email address.");
  const { sendEmail } = await import("./email/send");
  const sent = await sendEmail({ workspaceId, userId, to: content.business.email, subject: edits?.subject ?? content.subject, body: edits?.body ?? content.body, kind: "FOLLOW_UP", businessId: f.businessId, conversationId: f.conversationId, campaignId: f.campaignId });
  await db.followUp.update({ where: { id }, data: { status: "SENT", sentMessageId: sent.message.id, subject: edits?.subject ?? content.subject, body: edits?.body ?? content.body } });
  return sent;
}
