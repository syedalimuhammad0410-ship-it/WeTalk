import { api } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { enqueueJob } from "@/lib/server/jobs/queue";

/** Re-checks unmatched inbox conversations and files unrelated ones under "Filtered". */
export const POST = api({}, async (_req, ctx) => {
  assertCan(ctx, "emails.send");
  const job = await enqueueJob({ workspaceId: ctx.workspace.id, type: "BULK_ACTION", label: "Clean up inbox (filter unrelated emails)", payload: { op: "inbox_cleanup" }, createdById: ctx.user.id });
  return { jobId: job.id };
});
