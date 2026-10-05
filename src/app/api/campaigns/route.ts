import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { logActivity } from "@/lib/server/activity";
import { CampaignBody } from "@/lib/schemas";


export const POST = api({ permission: "campaigns.manage" }, async (req, ctx) => {
  const b = await parseBody(req, CampaignBody);
  const c = await db.campaign.create({ data: { workspaceId: ctx.workspace.id, ...b, searchSettings: b.searchSettings as object } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "campaign.created", summary: `Campaign “${c.name}” created` });
  return { id: c.id };
});
