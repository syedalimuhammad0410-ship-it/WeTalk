import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";

export const POST = api({ permission: "emails.send" }, async (_req, ctx, p) => {
  const f = await db.followUp.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } } });
  if (!f) throw new AppError("NOT_FOUND", "Follow-up not found or already processed.");
  await db.followUp.update({ where: { id: f.id }, data: { status: "CANCELLED", cancelReason: "Cancelled manually" } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, businessId: f.businessId, action: "followup.cancelled", summary: `Follow-up step ${f.step} cancelled manually` });
  return { ok: true };
});
