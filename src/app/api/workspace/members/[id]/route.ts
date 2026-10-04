import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { changeMemberRole, removeMember } from "@/lib/server/members";

export const PATCH = api({ permission: "users.manage" }, async (req, ctx, p) => {
  const { role } = await parseBody(req, z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) }));
  await changeMemberRole(ctx.workspace.id, { id: ctx.user.id, role: ctx.role }, p.id!, role);
  return { ok: true };
});

export const DELETE = api({ permission: "users.manage" }, async (_req, ctx, p) => {
  await removeMember(ctx.workspace.id, { id: ctx.user.id, role: ctx.role }, p.id!);
  return { ok: true };
});
