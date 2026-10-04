import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { logActivity } from "@/lib/server/activity";

const Body = z.object({
  maxEmailsPerDay: z.number().int().min(1).max(2000),
  maxEmailsPerHour: z.number().int().min(1).max(500),
  maxFollowUps: z.number().int().min(0).max(5),
  minMinutesBetweenSends: z.number().int().min(0).max(240),
  minDaysBetweenContacts: z.number().int().min(0).max(60),
  includeUnsubscribeFooter: z.boolean(),
  unsubscribeText: z.string().max(500),
  physicalAddress: z.string().max(300),
  aiDisclosureEnabled: z.boolean(),
  aiDisclosureText: z.string().max(300),
  blockFreeEmailDomains: z.boolean(),
  dataRetentionDays: z.number().int().min(0).max(3650),
}).partial().refine((v) => !(v.maxEmailsPerHour && v.maxEmailsPerDay && v.maxEmailsPerHour > v.maxEmailsPerDay), { message: "Hourly limit cannot exceed the daily limit" });

export const PATCH = api({ permission: "compliance.manage" }, async (req, ctx) => {
  const body = await parseBody(req, Body);
  await db.complianceSettings.upsert({ where: { workspaceId: ctx.workspace.id }, create: { workspaceId: ctx.workspace.id, ...body }, update: body });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "settings.compliance_updated", summary: `Compliance settings updated (${Object.keys(body).join(", ")})` });
  return { ok: true };
});
