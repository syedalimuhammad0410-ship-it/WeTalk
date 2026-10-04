import { db } from "@/lib/db";
import { api } from "@/lib/server/api";

export const GET = api({}, async (req, ctx) => {
  const active = req.nextUrl.searchParams.get("active") === "1";
  return db.job.findMany({
    where: { workspaceId: ctx.workspace.id, ...(active ? { status: { in: ["QUEUED", "RUNNING"] } } : {}), type: { notIn: ["EMAIL_SYNC", "INBOUND_ANALYSIS", "FOLLOW_UP_DISPATCH"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, type: true, status: true, label: true, progress: true, total: true, processed: true, message: true, error: true, createdAt: true, finishedAt: true },
  });
});
