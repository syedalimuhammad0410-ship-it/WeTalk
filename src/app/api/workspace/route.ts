import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";

export const PATCH = api({}, async (req, ctx) => {
  const body = await parseBody(req, z.object({ name: z.string().trim().min(2).max(80).optional(), onboardingStep: z.number().int().min(1).max(10).optional(), onboardingCompleted: z.boolean().optional() }));
  if (body.name) assertCan(ctx, "users.manage");
  await db.workspace.update({ where: { id: ctx.workspace.id }, data: body });
  return { ok: true };
});

/** Permanently deletes the workspace and ALL of its data. Owner only; requires typing the workspace name. */
export const DELETE = api({ permission: "workspace.delete" }, async (req, ctx) => {
  const { confirmName } = await parseBody(req, z.object({ confirmName: z.string() }));
  if (confirmName.trim() !== ctx.workspace.name) throw new AppError("VALIDATION", "Type the exact workspace name to confirm deletion.");
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "workspace.deleted", summary: "Workspace deleted" });
  await db.workspace.delete({ where: { id: ctx.workspace.id } });
  await db.user.update({ where: { id: ctx.user.id }, data: { lastWorkspaceId: null } });
  return { ok: true };
});
