import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";

export const GET = api({}, async (_req, ctx, p) => {
  const job = await db.job.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id }, select: { id: true, type: true, status: true, label: true, progress: true, total: true, processed: true, message: true, error: true, result: true, createdAt: true, startedAt: true, finishedAt: true } });
  if (!job) throw new AppError("NOT_FOUND", "Job not found.");
  return job;
});
