import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/activity";
import { RESPONSE_TONES, AI_MODELS } from "@/lib/constants";

const Body = z.object({
  aiWebsiteAnalysis: z.boolean(), aiPromptGeneration: z.boolean(), aiOutreachGeneration: z.boolean(), aiResponseAnalysis: z.boolean(), aiResponseDrafting: z.boolean(),
  automaticReplies: z.boolean(), automaticFollowUps: z.boolean(),
  responseMode: z.enum(["MANUAL", "APPROVAL_REQUIRED", "AUTOMATIC"]),
  autoReplyMinConfidence: z.number().int().min(50).max(100),
  humanReviewBelowConfidence: z.number().int().min(0).max(100),
  aiModel: z.enum(AI_MODELS.map((m) => m.id) as [string, ...string[]]),
  aiEffort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  responseTone: z.enum(RESPONSE_TONES),
  maxResponseWords: z.number().int().min(40).max(600),
  promptBehavior: z.string().max(4000),
  requireSendConfirmation: z.boolean(),
  followUpDays: z.array(z.number().int().min(1).max(60)).max(5),
}).partial();

export const PATCH = api({}, async (req, ctx) => {
  const body = await parseBody(req, Body);
  assertCan(ctx, "automation.manage");
  const enablingAuto = body.automaticReplies === true || body.responseMode === "AUTOMATIC" || body.automaticFollowUps === true;
  if (enablingAuto) assertCan(ctx, "autoReplies.enable");
  const before = await db.automationSettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
  const after = await db.automationSettings.upsert({ where: { workspaceId: ctx.workspace.id }, create: { workspaceId: ctx.workspace.id, ...body }, update: body });
  const changes = Object.keys(body).filter((k) => JSON.stringify((before as Record<string, unknown> | null)?.[k]) !== JSON.stringify((after as Record<string, unknown>)[k]));
  for (const k of changes.filter((k) => typeof (after as Record<string, unknown>)[k] === "boolean")) {
    await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: (after as Record<string, unknown>)[k] ? "automation.enabled" : "automation.disabled", summary: `${k} ${(after as Record<string, unknown>)[k] ? "enabled" : "disabled"}` });
  }
  if (changes.some((k) => typeof (after as Record<string, unknown>)[k] !== "boolean")) {
    await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "settings.automation_updated", summary: `Automation settings updated (${changes.filter((k) => typeof (after as Record<string, unknown>)[k] !== "boolean").join(", ")})` });
  }
  return { ok: true };
});
