import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";

export const POST = api({}, async (req, ctx) => {
  const b = await parseBody(req, z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }));
  await db.notification.updateMany({ where: { workspaceId: ctx.workspace.id, userId: ctx.user.id, readAt: null, ...(b.all ? {} : { id: { in: b.ids ?? [] } }) }, data: { readAt: new Date() } });
  return { ok: true };
});
