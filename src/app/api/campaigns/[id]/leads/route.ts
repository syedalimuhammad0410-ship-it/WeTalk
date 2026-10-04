import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";

export const POST = api({ permission: "campaigns.manage" }, async (req, ctx, p) => {
  const c = await db.campaign.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!c) throw new AppError("NOT_FOUND", "Campaign not found.");
  const { add = [], remove = [] } = await parseBody(req, z.object({ add: z.array(z.string()).max(1000).optional(), remove: z.array(z.string()).max(1000).optional() }));
  const valid = await db.business.findMany({ where: { workspaceId: ctx.workspace.id, id: { in: add } }, select: { id: true } });
  if (valid.length) await db.campaignLead.createMany({ data: valid.map((v) => ({ campaignId: c.id, businessId: v.id })), skipDuplicates: true });
  if (remove.length) await db.campaignLead.deleteMany({ where: { campaignId: c.id, businessId: { in: remove } } });
  return { added: valid.length, removed: remove.length };
});
