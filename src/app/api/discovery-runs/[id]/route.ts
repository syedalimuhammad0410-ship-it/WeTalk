import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { controlDiscoveryRun, zoneSummary } from "@/lib/server/discovery/run";

export const GET = api({ permission: "leads.view" }, async (_req, ctx, p) => {
  const run = await db.discoveryRun.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!run) throw new AppError("NOT_FOUND", "Discovery run not found.");
  const failed = await db.discoveryZone.findMany({ where: { runId: run.id, status: "FAILED" }, select: { label: true, query: true, error: true }, take: 20 });
  return { run, zones: await zoneSummary(run.id), failed };
});

const Body = z.object({
  action: z.enum(["pause", "resume", "cancel", "retry_failed", "continue"]),
  addTarget: z.coerce.number().int().min(0).max(20000).optional(),
  addRequests: z.coerce.number().int().min(0).max(50000).optional(),
  addQueries: z.array(z.string().trim().min(2).max(100)).max(20).optional(),
  addLocations: z.array(z.string().trim().min(2).max(200)).max(20).optional(),
});

export const PATCH = api({ permission: "discovery.run" }, async (req, ctx, p) => {
  const b = await parseBody(req, Body);
  await controlDiscoveryRun(ctx.workspace.id, p.id!, b.action, b);
  return { ok: true };
});
