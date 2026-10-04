import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { logActivity } from "@/lib/server/activity";

export const CampaignBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]).default("DRAFT"),
  templateId: z.string().nullable().optional(),
  promptStrategy: z.string().max(4000).default(""),
  followUpDays: z.array(z.number().int().min(1).max(60)).max(5).default([4, 10]),
  followUpMode: z.enum(["APPROVAL", "AUTOMATIC"]).default("APPROVAL"),
  searchSettings: z.record(z.string(), z.unknown()).default({}),
});

export const POST = api({ permission: "campaigns.manage" }, async (req, ctx) => {
  const b = await parseBody(req, CampaignBody);
  const c = await db.campaign.create({ data: { workspaceId: ctx.workspace.id, ...b, searchSettings: b.searchSettings as object } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "campaign.created", summary: `Campaign “${c.name}” created` });
  return { id: c.id };
});
