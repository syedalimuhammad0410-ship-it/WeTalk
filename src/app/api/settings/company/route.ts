import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/activity";

const s = (max: number) => z.string().trim().max(max);
const Body = z.object({
  companyName: s(120), senderName: s(120), description: s(2000), services: z.array(s(120)).max(40), website: s(300), email: z.union([z.literal(""), z.string().trim().email()]), phone: s(40), location: s(200),
  targetBusinesses: s(1000), serviceAreas: s(1000), typicalFeatures: s(2000), pricingEnabled: z.boolean(), pricingDetails: s(3000), meetingLink: z.union([z.literal(""), z.string().trim().url("Meeting link must be a full URL")]), brandVoice: s(1000), permittedClaims: s(3000),
}).partial();

export const GET = api({}, async (_req, ctx) => db.companyProfile.upsert({ where: { workspaceId: ctx.workspace.id }, create: { workspaceId: ctx.workspace.id }, update: {} }));

export const PATCH = api({}, async (req, ctx) => {
  assertCan(ctx, "leads.edit");
  const body = await parseBody(req, Body);
  if (body.pricingEnabled !== undefined || body.permittedClaims !== undefined) assertCan(ctx, "compliance.manage");
  await db.companyProfile.upsert({ where: { workspaceId: ctx.workspace.id }, create: { workspaceId: ctx.workspace.id, ...body }, update: body });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "settings.company_updated", summary: "Company profile updated" });
  return { ok: true };
});
