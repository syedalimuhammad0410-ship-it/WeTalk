import { api } from "@/lib/server/api";
import { getLeadOrThrow } from "@/lib/server/leads";
import { runWebsiteAudit } from "@/lib/server/audit/service";

/** Runs the audit synchronously (typically 5–40s) so the UI can show the result immediately. */
export const POST = api({ permission: "audits.run" }, async (_req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  return runWebsiteAudit(ctx.workspace.id, lead.id, { userId: ctx.user.id });
});
export const maxDuration = 120;
