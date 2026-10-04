import { api } from "@/lib/server/api";
import { cancelJob } from "@/lib/server/jobs/queue";

export const POST = api({ permission: "leads.edit" }, async (_req, ctx, p) => {
  await cancelJob(ctx.workspace.id, p.id!);
  return { ok: true };
});
