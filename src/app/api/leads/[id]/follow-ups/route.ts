import { api } from "@/lib/server/api";
import { getLeadOrThrow } from "@/lib/server/leads";
import { cancelFollowUps } from "@/lib/server/followups";

export const DELETE = api({ permission: "emails.send" }, async (_req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const count = await cancelFollowUps(ctx.workspace.id, lead.id, "Stopped manually", ctx.user.id);
  return { cancelled: count };
});
