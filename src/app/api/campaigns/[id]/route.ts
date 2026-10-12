import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";
import { CampaignPatch } from "@/lib/schemas";
import * as z from "zod";

export const PATCH = api({ permission: "campaigns.manage" }, async (req, ctx, p) => {
  const c = await db.campaign.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!c) throw new AppError("NOT_FOUND", "Campaign not found.");
  const b = await parseBody(req, CampaignPatch);
  if (b.followUpMode === "AUTOMATIC" && c.followUpMode !== "AUTOMATIC") assertCan(ctx, "autoReplies.enable");
  if (b.templateId && !(await db.emailTemplate.findFirst({ where: { id: b.templateId, workspaceId: ctx.workspace.id, kind: "OUTREACH" }, select: { id: true } }))) throw new AppError("VALIDATION", "That email template no longer exists. Pick another one.");
  await db.campaign.update({ where: { id: c.id }, data: { ...b, searchSettings: b.searchSettings as object | undefined } });
  // Follow-ups already scheduled follow the campaign's current mode.
  if (b.followUpMode && b.followUpMode !== c.followUpMode) await db.followUp.updateMany({ where: { campaignId: c.id, status: "SCHEDULED" }, data: { automatic: b.followUpMode === "AUTOMATIC" } });
  // A completed campaign sends nothing more.
  if (b.status === "COMPLETED" && c.status !== "COMPLETED") await db.followUp.updateMany({ where: { campaignId: c.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED", cancelReason: "Campaign completed" } });
  if (b.status && b.status !== c.status) await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "campaign.status", summary: `Campaign “${c.name}” → ${b.status.toLowerCase()}` });
  return { ok: true };
});

export const DELETE = api({ permission: "leads.delete" }, async (req, ctx, p) => {
  const c = await db.campaign.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!c) throw new AppError("NOT_FOUND", "Campaign not found.");
  const { confirmName } = await parseBody(req, z.object({ confirmName: z.string() }));
  if (confirmName.trim() !== c.name) throw new AppError("VALIDATION", "Type the campaign name to confirm. Leads are kept; only the campaign grouping is deleted.");
  await db.followUp.updateMany({ where: { campaignId: c.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED", cancelReason: "Campaign deleted" } });
  await db.campaign.delete({ where: { id: c.id } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "campaign.deleted", summary: `Campaign “${c.name}” deleted (leads kept)` });
  return { ok: true };
});
