import { db } from "@/lib/db";
import { api } from "@/lib/server/api";

export const GET = api({}, async (req, ctx) => {
  const cursor = req.nextUrl.searchParams.get("cursor");
  return db.activityLog.findMany({
    where: { workspaceId: ctx.workspace.id, ...(req.nextUrl.searchParams.get("businessId") ? { businessId: req.nextUrl.searchParams.get("businessId")! } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { name: true } }, business: { select: { id: true, name: true } } },
  });
});
