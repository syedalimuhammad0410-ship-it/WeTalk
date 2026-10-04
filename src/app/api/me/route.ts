import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

export const GET = api({}, async (_req, ctx) => {
  const memberships = await db.workspaceMember.findMany({ where: { userId: ctx.user.id }, include: { workspace: { select: { id: true, name: true, isDemo: true } } } });
  return { user: ctx.user, workspace: ctx.workspace, role: ctx.role, permissions: Array.from(ROLE_PERMISSIONS[ctx.role]), workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })) };
});

export const PATCH = api({}, async (req, ctx) => {
  const body = await parseBody(req, z.object({ name: z.string().trim().min(1).max(100).optional(), themePreference: z.enum(["light", "dark", "system"]).optional() }));
  await db.user.update({ where: { id: ctx.user.id }, data: body });
  return { ok: true };
});
