import "./guard";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "./errors";
import { logActivity } from "./activity";
import { recipientEligibility } from "./contacts/discover";

export type OutreachFilters = { campaignId?: string; city?: string; businessType?: string; eligibility?: string; page?: number };

function businessWhere(f: OutreachFilters): Prisma.BusinessWhereInput {
  return {
    ...(f.city ? { city: { contains: f.city, mode: "insensitive" } } : {}),
    ...(f.businessType ? { businessType: f.businessType } : {}),
  };
}

/** Outreach dashboard numbers (filtered by campaign / location / category). */
export async function outreachStats(workspaceId: string, f: OutreachFilters) {
  const biz = businessWhere(f);
  const msg = { workspaceId, kind: "OUTREACH" as const, ...(f.campaignId ? { campaignId: f.campaignId } : {}), business: biz };
  const [drafts, awaiting, sent, failed, eligibleDrafts, replies, unsubscribes, suppressed, interested] = await Promise.all([
    db.emailMessage.count({ where: msg }),
    db.emailMessage.count({ where: { ...msg, status: "DRAFT" } }),
    db.emailMessage.count({ where: { ...msg, status: "SENT" } }),
    db.emailMessage.count({ where: { ...msg, status: { in: ["FAILED", "BOUNCED"] } } }),
    db.emailMessage.count({ where: { ...msg, status: "DRAFT", business: { ...biz, contacts: { some: { eligibility: "ELIGIBLE" } } } } }),
    db.emailMessage.count({ where: { workspaceId, direction: "INBOUND", conversation: { filtered: false }, business: { ...biz, ...(f.campaignId ? { campaignLeads: { some: { campaignId: f.campaignId } } } : {}) } } }),
    db.suppressionEntry.count({ where: { workspaceId, reason: { contains: "nsubscribe" } } }),
    db.suppressionEntry.count({ where: { workspaceId } }),
    db.business.count({ where: { workspaceId, ...biz, status: { in: ["INTERESTED", "MEETING", "PROPOSAL", "WON"] }, ...(f.campaignId ? { campaignLeads: { some: { campaignId: f.campaignId } } } : {}) } }),
  ]);
  return { drafts, awaiting, eligible: eligibleDrafts, sent, failed, replies, unsubscribes, suppressed, interested };
}

/** Drafts waiting for a decision, with the recipient's eligibility evidence. */
export async function outreachQueue(workspaceId: string, f: OutreachFilters) {
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.EmailMessageWhereInput = {
    workspaceId, kind: "OUTREACH", status: "DRAFT", ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    business: { ...businessWhere(f), ...(f.eligibility ? { contacts: { some: { eligibility: f.eligibility } } } : {}) },
  };
  const [total, rows] = await Promise.all([
    db.emailMessage.count({ where }),
    db.emailMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25, include: { business: { select: { id: true, name: true, city: true, businessType: true, opportunityScore: true, doNotContact: true } }, campaign: { select: { id: true, name: true } } } }),
  ]);
  const items = await Promise.all(
    rows.map(async (m) => ({
      id: m.id, subject: m.subject, body: m.bodyText, to: m.toAddress, aiGenerated: m.aiGenerated, createdAt: m.createdAt, business: m.business, campaign: m.campaign,
      notes: ((m.analysis as { notes?: string[] } | null)?.notes ?? []).slice(0, 4),
      unfilled: /\{\{\s*[a-z_]+\s*\}\}/.test(m.subject + m.bodyText),
      eligibility: m.toAddress ? await recipientEligibility(workspaceId, m.businessId, m.toAddress) : { eligibility: "INELIGIBLE", basis: "NONE", reason: "No recipient address.", contactId: null },
    })),
  );
  return { total, page, pageSize: 25, items };
}

/** Human approval: records the decision and queues the sends (limits and spacing enforced by the sender). */
export async function approveOutreach(workspaceId: string, userId: string, messageIds: string[], confirmCount: number) {
  if (confirmCount !== messageIds.length) throw new AppError("VALIDATION", "Confirmation count does not match the number of emails.");
  const drafts = await db.emailMessage.findMany({ where: { workspaceId, id: { in: messageIds }, status: "DRAFT", kind: "OUTREACH" } });
  const approved: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const d of drafts) {
    if (!d.toAddress) { skipped.push({ id: d.id, reason: "No recipient" }); continue; }
    if (/\{\{\s*[a-z_]+\s*\}\}/.test(d.subject + d.bodyText)) { skipped.push({ id: d.id, reason: "Has unfilled template variables" }); continue; }
    const e = await recipientEligibility(workspaceId, d.businessId, d.toAddress);
    if (e.eligibility === "INELIGIBLE") { skipped.push({ id: d.id, reason: e.reason }); continue; }
    await db.outreachApproval.upsert({ where: { messageId: d.id }, create: { workspaceId, messageId: d.id, businessId: d.businessId, email: d.toAddress, decision: "APPROVED", eligibility: e as Prisma.InputJsonValue, decidedById: userId }, update: { decision: "APPROVED", decidedById: userId, decidedAt: new Date(), eligibility: e as Prisma.InputJsonValue } });
    approved.push(d.id);
  }
  let jobId: string | null = null;
  if (approved.length) {
    const { enqueueJob } = await import("./jobs/queue");
    jobId = (await enqueueJob({ workspaceId, type: "BULK_ACTION", label: `Send ${approved.length} approved outreach email${approved.length === 1 ? "" : "s"}`, payload: { messageIds: approved }, createdById: userId })).id;
    await logActivity({ workspaceId, userId, action: "outreach.approved", summary: `${approved.length} outreach email${approved.length === 1 ? "" : "s"} approved for sending${skipped.length ? ` (${skipped.length} blocked)` : ""}` });
  }
  return { approved: approved.length, skipped, jobId };
}

export async function rejectOutreach(workspaceId: string, userId: string, messageIds: string[]) {
  const drafts = await db.emailMessage.findMany({ where: { workspaceId, id: { in: messageIds }, status: "DRAFT", kind: "OUTREACH" } });
  for (const d of drafts) {
    await db.outreachApproval.upsert({ where: { messageId: d.id }, create: { workspaceId, messageId: d.id, businessId: d.businessId, email: d.toAddress, decision: "REJECTED", decidedById: userId }, update: { decision: "REJECTED", decidedById: userId, decidedAt: new Date() } });
    await db.emailMessage.delete({ where: { id: d.id } });
  }
  await db.automationItem.updateMany({ where: { workspaceId, draftMessageId: { in: drafts.map((d) => d.id) } }, data: { draftMessageId: null } });
  if (drafts.length) await logActivity({ workspaceId, userId, action: "outreach.rejected", summary: `${drafts.length} outreach draft${drafts.length === 1 ? "" : "s"} rejected` });
  return { rejected: drafts.length };
}
