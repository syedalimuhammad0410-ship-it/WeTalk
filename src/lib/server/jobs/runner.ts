import "../guard";
import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import { describeError } from "../errors";
import { claimNextJob, makeContext, recoverStaleJobs } from "./queue";

let running = false;
let started = false;
let wake: (() => void) | null = null;
const CONCURRENCY = 2;
let active = 0;

export function kickRunner() {
  wake?.();
}

async function runOne() {
  const job = await claimNextJob();
  if (!job) return false;
  active++;
  const ctx = makeContext(job);
  (async () => {
    try {
      const { HANDLERS } = await import("./handlers");
      const result = await HANDLERS[job.type](job, ctx);
      const cancelled = await ctx.isCancelled();
      await db.job.update({
        where: { id: job.id },
        data: {
          status: cancelled ? "CANCELLED" : "COMPLETED",
          result: JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue,
          progress: cancelled ? undefined : 100,
          finishedAt: new Date(),
          message: cancelled ? "Cancelled" : (result as { message?: string } | null)?.message ?? "Completed",
          lockedAt: null,
        },
      });
    } catch (e) {
      const retry = job.attempts < job.maxAttempts;
      await db.job.update({
        where: { id: job.id },
        data: retry
          ? { status: "QUEUED", runAfter: new Date(Date.now() + 60_000 * job.attempts), error: describeError(e).slice(0, 2000), lockedAt: null }
          : { status: "FAILED", error: describeError(e).slice(0, 2000), finishedAt: new Date(), lockedAt: null, message: describeError(e).slice(0, 300) },
      });
    } finally {
      active--;
      kickRunner();
    }
  })();
  return true;
}

let lastTick = 0;
/** Periodic maintenance: enqueue inbox sync + follow-up dispatch, recover stale jobs. */
async function maintenance() {
  if (Date.now() - lastTick < 120_000) return;
  lastTick = Date.now();
  await recoverStaleJobs();
  const workspaces = await db.workspace.findMany({ select: { id: true, emailAccounts: { select: { provider: true } } } });
  for (const w of workspaces) {
    if (w.emailAccounts.some((a) => a.provider === "GMAIL")) {
      const pending = await db.job.findFirst({ where: { workspaceId: w.id, type: "EMAIL_SYNC", status: { in: ["QUEUED", "RUNNING"] } } });
      if (!pending) await db.job.create({ data: { workspaceId: w.id, type: "EMAIL_SYNC", label: "Check inbox" } });
    }
    const due = await db.followUp.findFirst({ where: { workspaceId: w.id, status: "SCHEDULED", scheduledFor: { lte: new Date() } }, select: { id: true } });
    if (due) {
      const pending = await db.job.findFirst({ where: { workspaceId: w.id, type: "FOLLOW_UP_DISPATCH", status: { in: ["QUEUED", "RUNNING"] } } });
      if (!pending) await db.job.create({ data: { workspaceId: w.id, type: "FOLLOW_UP_DISPATCH", label: "Process due follow-ups" } });
    }
  }
}

export async function runnerLoop(opts: { once?: boolean } = {}) {
  if (running) return;
  running = true;
  try {
    for (;;) {
      try {
        await maintenance();
        while (active < CONCURRENCY && (await runOne())) {
          /* claim until saturated */
        }
      } catch (e) {
        console.error("[jobs] runner error", e);
      }
      if (opts.once && active === 0) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, opts.once ? 200 : 5000);
      });
      wake = null;
    }
  } finally {
    running = false;
  }
}

/** Starts the in-process runner once per server process. */
export function startInlineRunner() {
  if (started) return;
  started = true;
  void runnerLoop();
}

/** Test helper: run queued jobs until none remain. */
export async function drainJobs(timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const claimed = await runOne();
    if (!claimed && active === 0) {
      const queued = await db.job.count({ where: { status: "QUEUED", runAfter: { lte: new Date() } } });
      if (!queued) return;
    }
    if (Date.now() > end) throw new Error("drainJobs timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}
