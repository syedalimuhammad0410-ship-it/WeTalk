import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { logActivity } from "@/lib/server/activity";
import { assertCan } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { CampaignBody } from "@/lib/schemas";


export const POST = api({ permission: "campaigns.manage" }, async (req, ctx) => {
  const b = await parseBody(req, CampaignBody);
  if (b.followUpMode === "AUTOMATIC") assertCan(ctx, "autoReplies.enable");
  if (b.templateId && !(await db.emailTemplate.findFirst({ where: { id: b.templateId, workspaceId: ctx.workspace.id, kind: "OUTREACH" }, select: { id: true } }))) throw new AppError("VALIDATION", "That email template no longer exists. Pick another one.");
  const c = await db.campaign.create({ data: { workspaceId: ctx.workspace.id, ...b, searchSettings: b.searchSettings as object } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "campaign.created", summary: `Campaign “${c.name}” created` });
  return { id: c.id };
});
