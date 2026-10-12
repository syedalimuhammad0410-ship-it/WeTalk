import * as z from "zod";

const CampaignShape = {
  name: z.string().trim().min(2, "Campaign name must be at least 2 characters").max(120),
  description: z.string().trim().max(2000),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]),
  templateId: z.string().nullable().optional(),
  promptStrategy: z.string().max(4000),
  followUpDays: z.array(z.number().int().min(1, "Follow-up days must be 1 or more").max(60, "Follow-up days can be at most 60")).max(5, "At most 5 follow-up days"),
  followUpMode: z.enum(["APPROVAL", "AUTOMATIC"]),
  searchSettings: z.record(z.string(), z.unknown()),
};
/** Creating a campaign: missing fields get defaults. */
export const CampaignBody = z.object({
  ...CampaignShape,
  description: CampaignShape.description.default(""),
  status: CampaignShape.status.default("DRAFT"),
  promptStrategy: CampaignShape.promptStrategy.default(""),
  followUpDays: CampaignShape.followUpDays.default([4, 10]),
  followUpMode: CampaignShape.followUpMode.default("APPROVAL"),
  searchSettings: CampaignShape.searchSettings.default({}),
});
/** Updating a campaign: only the fields sent are changed (no defaults, so Pause/Activate never wipe settings). */
export const CampaignPatch = z.object(CampaignShape).partial();

export const TemplateBody = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["OUTREACH", "FOLLOW_UP", "REPLY"]), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(10000) });
