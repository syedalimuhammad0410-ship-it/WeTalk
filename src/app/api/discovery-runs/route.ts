import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { logActivity } from "@/lib/server/activity";
import { createDiscoveryRun, DiscoveryRunInput, enqueueDiscoveryRun, zoneSummary } from "@/lib/server/discovery/run";

/** Large-area (tiled, resumable) discovery. */
export const POST = api({ permission: "discovery.run" }, async (req, ctx) => {
  const input = await parseBody(req, DiscoveryRunInput);
  const run = await createDiscoveryRun(ctx.workspace.id, ctx.user.id, input);
  await enqueueDiscoveryRun(run, `Find “${input.queries.join(", ")}” in ${input.locations.join("; ")}`.slice(0, 180));
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "discovery.started", summary: `Large-area discovery started: ${input.queries.join(", ")} in ${input.locations.join("; ")} (target ${input.target})` });
  return { id: run.id };
});

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => {
  const runs = await db.discoveryRun.findMany({ where: { workspaceId: ctx.workspace.id, automationRunId: null }, orderBy: { createdAt: "desc" }, take: 15 });
  return { runs: await Promise.all(runs.map(async (r) => ({ ...r, zones: await zoneSummary(r.id) }))) };
});
