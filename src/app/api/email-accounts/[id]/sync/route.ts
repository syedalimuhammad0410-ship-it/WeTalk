import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { enqueueJob } from "@/lib/server/jobs/queue";

export const POST = api({}, async (_req, ctx, p) => {
  const acc = await db.emailAccount.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!acc) throw new AppError("NOT_FOUND", "Email account not found.");
  if (acc.provider !== "GMAIL") return { ok: true, message: acc.provider === "POSTMARK" ? "Postmark delivers replies instantly by webhook — nothing to sync." : "The sandbox has no real inbox. Use “Simulate reply” in a conversation." };
  // One sync at a time: a second click joins the one already running.
  const running = await db.job.findFirst({ where: { workspaceId: ctx.workspace.id, type: "EMAIL_SYNC", status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (running) return { ok: true, jobId: running.id, message: "Already checking inbox…" };
  const job = await enqueueJob({ workspaceId: ctx.workspace.id, type: "EMAIL_SYNC", label: "Check inbox", createdById: ctx.user.id });
  return { ok: true, jobId: job.id, message: "Checking inbox…" };
});
