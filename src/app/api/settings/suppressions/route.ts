import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";

export const GET = api({}, async (_req, ctx) => db.suppressionEntry.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { createdAt: "desc" }, take: 500 }));

export const POST = api({ permission: "compliance.manage" }, async (req, ctx) => {
  const { value, reason } = await parseBody(req, z.object({ value: z.string().trim().toLowerCase().max(200), reason: z.string().trim().max(200).default("Added manually") }));
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(value) && !/^@[^\s@]+\.[a-z]{2,}$/.test(value)) throw new AppError("VALIDATION", "Enter an email address or a domain like @example.com");
  await db.suppressionEntry.upsert({ where: { workspaceId_value: { workspaceId: ctx.workspace.id, value } }, create: { workspaceId: ctx.workspace.id, value, reason }, update: { reason } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "compliance.suppressed", summary: `Added ${value} to the suppression list` });
  return { ok: true };
});

/** Removing a suppression is a deliberate, logged action (e.g. the contact explicitly opted back in). */
export const DELETE = api({ permission: "doNotContact.reverse" }, async (req, ctx) => {
  const { value, justification } = await parseBody(req, z.object({ value: z.string(), justification: z.string().trim().min(10, "Explain why this contact may be emailed again (min 10 characters)") }));
  await db.suppressionEntry.deleteMany({ where: { workspaceId: ctx.workspace.id, value } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "compliance.unsuppressed", summary: `Removed ${value} from the suppression list — ${justification}` });
  return { ok: true };
});
