import { api } from "@/lib/server/api";
import { retryJob } from "@/lib/server/jobs/queue";

export const POST = api({ permission: "leads.edit" }, async (_req, ctx, p) => {
  const job = await retryJob(ctx.workspace.id, p.id!);
  return { jobId: job.id };
});
