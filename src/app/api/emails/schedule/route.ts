import { api, parseBody } from "@/lib/server/api";
import { ScheduleInput, saveSchedule, scheduleState } from "@/lib/server/email/schedule";

/** The daily email schedule (Emails → Schedule). */
export const GET = api({}, async (_req, ctx) => scheduleState(ctx.workspace.id));

// Turning on automatic daily sending is an owner/admin decision.
export const PUT = api({ permission: "automation.manage" }, async (req, ctx) => saveSchedule(ctx.workspace.id, ctx.user.id, await parseBody(req, ScheduleInput)));
