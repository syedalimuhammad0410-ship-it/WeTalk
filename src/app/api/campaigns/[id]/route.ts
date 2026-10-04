import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";
import { CampaignBody } from "../route";
import * as z from "zod";

export const PATCH = api({ permission: "campaigns.manage" }, async (req, ctx, p) => {
  const c = await db.campaign.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!c) throw new AppError("NOT_FOUND", "Campaign not found.");
  const b = await parseBody(req, CampaignBody.partial());
  if (b.followUpMode === "AUTOMATIC") assertCan(ctx, "autoReplies.enable");
  await db.campaign.update({ where: { id: c.id }, data: { ...b, searchSettings: b.searchSettings as object | undefined } });
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
