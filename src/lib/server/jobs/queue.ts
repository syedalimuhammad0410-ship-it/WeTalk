import "../guard";
import type { Job, JobType, Prisma } from "@prisma/client";
import { db } from "../../db";
import { AppError } from "../errors";

export type JobContext = {
  job: Job;
  progress(p: { total?: number; processed?: number; message?: string }): Promise<void>;
  isCancelled(): Promise<boolean>;
};

export const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}:${crypto.randomUUID().slice(0, 8)}`;

export async function enqueueJob(i: { workspaceId: string; type: JobType; label: string; payload?: Prisma.InputJsonValue; createdById?: string | null; runAfter?: Date; maxAttempts?: number }) {
  const job = await db.job.create({
    data: { workspaceId: i.workspaceId, type: i.type, label: i.label, payload: i.payload ?? {}, createdById: i.createdById ?? null, runAfter: i.runAfter ?? new Date(), maxAttempts: i.maxAttempts ?? 1 },
  });
  // Wake the in-process runner (no-op when an external worker is used).
  const { kickRunner } = await import("./runner");
  kickRunner();
  return job;
}

/** Atomically claims the next runnable job (safe across multiple workers). */
export async function claimNextJob(): Promise<Job | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = NOW(), "lockedBy" = ${WORKER_ID}, "startedAt" = COALESCE("startedAt", NOW()), "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE "status" = 'QUEUED' AND "runAfter" <= NOW()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id"`;
  if (!rows[0]) return null;
  return db.job.findUnique({ where: { id: rows[0].id } });
}

/** Re-queues jobs whose worker died mid-run (lock older than 15 minutes). */
export async function recoverStaleJobs() {
  const stale = new Date(Date.now() - 15 * 60_000);
  const jobs = await db.job.findMany({ where: { status: "RUNNING", lockedAt: { lt: stale } } });
  for (const j of jobs) {
    await db.job.update({
      where: { id: j.id },
      data: j.attempts < j.maxAttempts ? { status: "QUEUED", lockedAt: null, lockedBy: null } : { status: "FAILED", error: "Worker stopped unexpectedly while running this job.", finishedAt: new Date() },
    });
  }
  return jobs.length;
}

export function makeContext(job: Job): JobContext {
  let lastWrite = 0;
  return {
    job,
    async progress(p) {
      const now = Date.now();
      if (now - lastWrite < 400 && p.processed !== p.total) return; // throttle writes
      lastWrite = now;
      const total = p.total ?? job.total;
      job.total = total;
      const processed = p.processed ?? job.processed;
      job.processed = processed;
      await db.job.update({
        where: { id: job.id },
        data: { total, processed, progress: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0, message: p.message ?? undefined, lockedAt: new Date() },
      });
    },
    async isCancelled() {
      const j = await db.job.findUnique({ where: { id: job.id }, select: { cancelRequested: true } });
      return Boolean(j?.cancelRequested);
    },
  };
}

export async function cancelJob(workspaceId: string, jobId: string) {
  const job = await db.job.findFirst({ where: { id: jobId, workspaceId } });
  if (!job) throw new AppError("NOT_FOUND", "Job not found.");
  if (job.status === "QUEUED") return db.job.update({ where: { id: jobId }, data: { status: "CANCELLED", cancelRequested: true, finishedAt: new Date(), message: "Cancelled before it started." } });
  if (job.status === "RUNNING") return db.job.update({ where: { id: jobId }, data: { cancelRequested: true, message: "Cancelling…" } });
  throw new AppError("CONFLICT", `Job is already ${job.status.toLowerCase()}.`);
}

export async function retryJob(workspaceId: string, jobId: string) {
  const job = await db.job.findFirst({ where: { id: jobId, workspaceId } });
  if (!job) throw new AppError("NOT_FOUND", "Job not found.");
  if (!["FAILED", "CANCELLED"].includes(job.status)) throw new AppError("CONFLICT", "Only failed or cancelled jobs can be retried.");
  return enqueueJob({ workspaceId, type: job.type, label: `${job.label} (retry)`, payload: job.payload as Prisma.InputJsonValue, createdById: job.createdById });
}
