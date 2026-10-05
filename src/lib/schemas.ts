import * as z from "zod";

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

export const TemplateBody = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["OUTREACH", "FOLLOW_UP", "REPLY"]), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(10000) });
