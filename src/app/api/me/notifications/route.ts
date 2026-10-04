import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";

export const PATCH = api({}, async (req, ctx) => {
  const prefs = await parseBody(req, z.record(z.string(), z.boolean()));
  await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId: ctx.user.id } }, data: { notificationPrefs: prefs } });
  return { ok: true };
});
