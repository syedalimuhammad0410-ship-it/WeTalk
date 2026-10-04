import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { changeLeadStatus } from "@/lib/server/leads";
import { enqueueJob } from "@/lib/server/jobs/queue";
import { logActivity } from "@/lib/server/activity";
import { LEAD_STATUSES } from "@/lib/constants";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: z.array(z.string()).min(1).max(1000), userId: z.string().nullable() }),
  z.object({ action: z.literal("tag"), ids: z.array(z.string()).min(1).max(1000), tag: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("archive"), ids: z.array(z.string()).min(1).max(1000), archived: z.boolean() }),
  z.object({ action: z.literal("status"), ids: z.array(z.string()).min(1).max(1000), status: z.enum(LEAD_STATUSES) }),
  z.object({ action: z.literal("audit"), ids: z.array(z.string()).min(1).max(1000) }),
  z.object({ action: z.literal("prompts"), ids: z.array(z.string()).min(1).max(500) }),
  z.object({ action: z.literal("emails"), ids: z.array(z.string()).min(1).max(500), templateId: z.string().nullable().optional(), campaignId: z.string().nullable().optional() }),
  z.object({ action: z.literal("send"), ids: z.array(z.string()).min(1).max(500), confirmCount: z.number().int() }),
  z.object({ action: z.literal("campaign"), ids: z.array(z.string()).min(1).max(1000), campaignId: z.string() }),
  z.object({ action: z.literal("delete"), ids: z.array(z.string()).min(1).max(500), confirmCount: z.number().int() }),
  z.object({ action: z.literal("preview_send"), ids: z.array(z.string()).min(1).max(500) }),
]);

export const POST = api({ permission: "leads.edit" }, async (req, ctx) => {
  const b = await parseBody(req, Body);
  const ws = ctx.workspace.id;
  const leads = await db.business.findMany({ where: { workspaceId: ws, id: { in: b.ids } }, select: { id: true, name: true, status: true, doNotContact: true, email: true } });
  const ids = leads.map((l) => l.id);
  if (!ids.length) throw new AppError("NOT_FOUND", "None of the selected leads exist in this workspace.");

  switch (b.action) {
    case "assign": {
      if (b.userId && !(await db.workspaceMember.findFirst({ where: { workspaceId: ws, userId: b.userId } }))) throw new AppError("VALIDATION", "Assignee is not a member.");
      await db.business.updateMany({ where: { id: { in: ids } }, data: { assignedToId: b.userId } });
      break;
    }
    case "tag": {
      const tag = await db.tag.upsert({ where: { workspaceId_name: { workspaceId: ws, name: b.tag } }, create: { workspaceId: ws, name: b.tag }, update: {} });
      await db.leadTag.createMany({ data: ids.map((id) => ({ businessId: id, tagId: tag.id })), skipDuplicates: true });
      break;
    }
    case "archive":
      await db.business.updateMany({ where: { id: { in: ids } }, data: { archived: b.archived } });
      break;
    case "status": {
      assertCan(ctx, "leads.changeStatus");
      let skipped = 0;
      for (const l of leads) {
        if (l.status === "DO_NOT_CONTACT" && b.status !== "DO_NOT_CONTACT") { skipped++; continue; } // reversal must be done individually with a reason
        await changeLeadStatus({ workspaceId: ws, businessId: l.id, to: b.status, userId: ctx.user.id, reason: "Bulk update" });
      }
      await logActivity({ workspaceId: ws, userId: ctx.user.id, action: "leads.bulk_status", summary: `Bulk status → ${b.status} for ${ids.length - skipped} leads` });
      return { updated: ids.length - skipped, skipped, message: skipped ? `${skipped} Do-Not-Contact lead(s) were skipped — reverse those individually.` : undefined };
    }
    case "audit": {
      assertCan(ctx, "audits.run");
      const job = await enqueueJob({ workspaceId: ws, type: "WEBSITE_AUDIT", label: `Analyse ${ids.length} websites`, payload: { businessIds: ids }, createdById: ctx.user.id });
      return { jobId: job.id };
    }
    case "prompts": {
      assertCan(ctx, "prompts.edit");
      const job = await enqueueJob({ workspaceId: ws, type: "PROMPT_GENERATION", label: `Generate ${ids.length} website prompts`, payload: { businessIds: ids }, createdById: ctx.user.id });
      return { jobId: job.id };
    }
    case "emails": {
      assertCan(ctx, "emails.compose");
      const eligible = leads.filter((l) => !l.doNotContact).map((l) => l.id);
      const job = await enqueueJob({ workspaceId: ws, type: "OUTREACH_GENERATION", label: `Generate ${eligible.length} outreach emails`, payload: { businessIds: eligible, templateId: b.templateId ?? null, campaignId: b.campaignId ?? null }, createdById: ctx.user.id });
      return { jobId: job.id, skipped: ids.length - eligible.length };
    }
    case "preview_send":
    case "send": {
      assertCan(ctx, "emails.send");
      const drafts = await db.emailMessage.findMany({ where: { workspaceId: ws, businessId: { in: ids }, status: "DRAFT", kind: "OUTREACH", toAddress: { not: "" } }, select: { id: true, businessId: true, toAddress: true } });
      const dncIds = new Set(leads.filter((l) => l.doNotContact).map((l) => l.id));
      const sendable = drafts.filter((d) => !dncIds.has(d.businessId!));
      const missing = ids.length - sendable.length;
      if (b.action === "preview_send") return { sendable: sendable.length, missingDraftsOrBlocked: missing, recipients: sendable.slice(0, 20).map((d) => d.toAddress) };
      if (b.confirmCount !== sendable.length) throw new AppError("CONFLICT", `Confirmation mismatch: ${sendable.length} emails are ready to send but you confirmed ${b.confirmCount}. Review and confirm again.`);
      if (!sendable.length) throw new AppError("VALIDATION", "No sendable outreach drafts among the selected leads. Generate emails first.");
      const job = await enqueueJob({ workspaceId: ws, type: "BULK_ACTION", label: `Send ${sendable.length} outreach emails`, payload: { messageIds: sendable.map((d) => d.id) }, createdById: ctx.user.id });
      await logActivity({ workspaceId: ws, userId: ctx.user.id, action: "emails.bulk_send", summary: `Bulk send of ${sendable.length} outreach emails started (confirmed)` });
      return { jobId: job.id, count: sendable.length };
    }
    case "campaign": {
      const c = await db.campaign.findFirst({ where: { id: b.campaignId, workspaceId: ws } });
      if (!c) throw new AppError("NOT_FOUND", "Campaign not found.");
      await db.campaignLead.createMany({ data: ids.map((id) => ({ campaignId: c.id, businessId: id })), skipDuplicates: true });
      break;
    }
    case "delete": {
      assertCan(ctx, "leads.delete");
      if (b.confirmCount !== ids.length) throw new AppError("CONFLICT", `You confirmed ${b.confirmCount} but ${ids.length} leads are selected. Nothing was deleted.`);
      await db.business.deleteMany({ where: { id: { in: ids }, workspaceId: ws } });
      await logActivity({ workspaceId: ws, userId: ctx.user.id, action: "leads.bulk_delete", summary: `Deleted ${ids.length} leads` });
      return { deleted: ids.length };
    }
  }
  await logActivity({ workspaceId: ws, userId: ctx.user.id, action: `leads.bulk_${b.action}`, summary: `Bulk ${b.action} applied to ${ids.length} leads` });
  return { updated: ids.length };
});
