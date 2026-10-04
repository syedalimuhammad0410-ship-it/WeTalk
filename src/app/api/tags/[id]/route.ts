import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";

export const DELETE = api({ permission: "leads.delete" }, async (_req, ctx, p) => {
  const t = await db.tag.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!t) throw new AppError("NOT_FOUND", "Tag not found.");
  await db.tag.delete({ where: { id: t.id } });
  return { ok: true };
});
