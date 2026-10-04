import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";

export const POST = api({}, async (req, ctx) => {
  const { workspaceId } = await parseBody(req, z.object({ workspaceId: z.string() }));
  const m = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } } });
  if (!m) throw new AppError("FORBIDDEN", "You are not a member of that workspace.");
  await db.user.update({ where: { id: ctx.user.id }, data: { lastWorkspaceId: workspaceId } });
  return { ok: true };
});
