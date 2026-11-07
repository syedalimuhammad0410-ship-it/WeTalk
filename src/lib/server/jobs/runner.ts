import "../guard";
import type { Job, Prisma } from "@prisma/client";
import { db } from "../../db";
import { describeError } from "../errors";
import { claimNextJob, makeContext, recoverStaleJobs } from "./queue";

let running = false;
let started = false;
let wake: (() => void) | null = null;
const CONCURRENCY = 2;
let active = 0;

/**
 * JOB_RUNNER: "inline" (default, in-process loop), "external" (`npm run worker`)
 * or "cron" (serverless, e.g. Cloudflare Workers: a scheduled trigger calls
 * /api/internal/cron, which runs runScheduledTick()).
 */
export function inlineRunnerEnabled() {
  const mode = process.env.JOB_RUNNER ?? "inline";
  return mode === "inline" && process.env.NODE_ENV !== "test" && !process.env.VITEST;
}

export function kickRunner() {
  // Lazily start the in-process runner (dev starts it here so it always runs current code).
  if (!started && inlineRunnerEnabled()) startInlineRunner();
  wake?.();
}

async function executeJob(job: Job) {
  const ctx = makeContext(job);
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
  }
}

async function runOne() {
  const job = await claimNextJob();
  if (!job) return false;
  active++;
  void executeJob(job).finally(() => {
    active--;
    kickRunner();
  });
  return true;
}

/** Searches/AutoProspect runs that are still "running" but have no live job (e.g. after a restart) carry on. */
async function resumeOrphanedRuns() {
  const quiet = new Date(Date.now() - 5 * 60_000);
  const active = await db.job.findMany({ where: { type: { in: ["DISCOVERY_RUN", "AUTOPROSPECT"] }, status: { in: ["QUEUED", "RUNNING"] } }, select: { payload: true } });
  const busy = new Set(active.map((j) => (j.payload as { runId?: string }).runId));
  const runs = await db.discoveryRun.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] }, automationRunId: null, updatedAt: { lt: quiet } }, select: { id: true, workspaceId: true, createdById: true } });
  for (const r of runs) {
    if (busy.has(r.id)) continue;
    await db.job.create({ data: { workspaceId: r.workspaceId, type: "DISCOVERY_RUN", label: "Resume business search", payload: { runId: r.id }, createdById: r.createdById, maxAttempts: 3 } });
  }
  const autos = await db.automationRun.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: quiet } }, select: { id: true, workspaceId: true, createdById: true, name: true } });
  for (const a of autos) {
    if (busy.has(a.id)) continue;
    await db.job.create({ data: { workspaceId: a.workspaceId, type: "AUTOPROSPECT", label: `AutoProspect: ${a.name}`, payload: { runId: a.id }, createdById: a.createdById, maxAttempts: 3 } });
  }
}

let lastTick = 0;
/** Periodic maintenance: enqueue inbox sync + follow-up dispatch, recover stale jobs. */
async function maintenance(force = false) {
  if (!force && Date.now() - lastTick < 120_000) return;
  lastTick = Date.now();
  await recoverStaleJobs();
  await resumeOrphanedRuns();
  const workspaces = await db.workspace.findMany({ select: { id: true, emailAccounts: { select: { provider: true } }, automation: { select: { automationPaused: true, inboxMonitoringEnabled: true, followUpSchedulingEnabled: true } } } });
  for (const w of workspaces) {
    // Automation Control Center: global pause and per-feature switches.
    if (w.automation?.automationPaused) continue;
    if (w.automation?.inboxMonitoringEnabled !== false && w.emailAccounts.some((a) => a.provider === "GMAIL")) {
      const pending = await db.job.findFirst({ where: { workspaceId: w.id, type: "EMAIL_SYNC", status: { in: ["QUEUED", "RUNNING"] } } });
      if (!pending) await db.job.create({ data: { workspaceId: w.id, type: "EMAIL_SYNC", label: "Check inbox" } });
    }
    if (w.automation?.followUpSchedulingEnabled === false) continue;
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

/**
 * One scheduled tick for serverless hosts: maintenance, then claim and run jobs
 * (up to CONCURRENCY at once) until the queue is empty or the claim window
 * closes. Jobs already started are awaited before returning.
 */
export async function runScheduledTick(opts: { claimWindowMs?: number } = {}) {
  const claimUntil = Date.now() + (opts.claimWindowMs ?? 50_000);
  await maintenance(true);
  let ran = 0;
  const lane = async () => {
    while (Date.now() < claimUntil) {
      const job = await claimNextJob();
      if (!job) return;
      ran++;
      await executeJob(job);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return { ran };
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
