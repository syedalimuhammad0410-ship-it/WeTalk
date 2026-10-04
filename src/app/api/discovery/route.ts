import { api, parseBody } from "@/lib/server/api";
import { DiscoveryInput } from "@/lib/server/discovery/service";
import { enqueueJob } from "@/lib/server/jobs/queue";
import { resolveIntegrationKey } from "@/lib/server/workspace";
import { AppError } from "@/lib/server/errors";
import { db } from "@/lib/db";

export const POST = api({ permission: "discovery.run" }, async (req, ctx) => {
  const input = await parseBody(req, DiscoveryInput);
  if (!(await resolveIntegrationKey(ctx.workspace.id, "GOOGLE_PLACES"))) throw new AppError("NOT_CONFIGURED", "Connect the Google Places API in Settings → Integrations to discover businesses.");
  if (input.campaignId && !(await db.campaign.findFirst({ where: { id: input.campaignId, workspaceId: ctx.workspace.id } }))) throw new AppError("NOT_FOUND", "Campaign not found.");
  const running = await db.job.count({ where: { workspaceId: ctx.workspace.id, type: "DISCOVERY", status: { in: ["QUEUED", "RUNNING"] } } });
  if (running >= 2) throw new AppError("RATE_LIMITED", "Two discovery searches are already running. Wait for one to finish.");
  const job = await enqueueJob({ workspaceId: ctx.workspace.id, type: "DISCOVERY", label: `Find ${input.limit} ${input.category || input.searchTerms} in ${input.location}`, payload: { input }, createdById: ctx.user.id });
  return { jobId: job.id };
});
