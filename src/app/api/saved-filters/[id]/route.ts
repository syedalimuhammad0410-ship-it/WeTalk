import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { can } from "@/lib/permissions";

export const DELETE = api({}, async (_req, ctx, p) => {
  const f = await db.savedFilter.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!f) throw new AppError("NOT_FOUND", "Saved filter not found.");
  if (f.userId !== ctx.user.id && !can(ctx.role, "users.manage")) throw new AppError("FORBIDDEN", "You can only delete your own saved filters.");
  await db.savedFilter.delete({ where: { id: f.id } });
  return { ok: true };
});
