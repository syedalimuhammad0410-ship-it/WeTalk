import { db } from "@/lib/db";
import { api } from "@/lib/server/api";

export const GET = api({}, async (_req, ctx) => {
  const where = { workspaceId: ctx.workspace.id, userId: ctx.user.id };
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 30 }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { items, unread };
});
