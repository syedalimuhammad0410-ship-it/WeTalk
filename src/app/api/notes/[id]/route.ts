import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { can } from "@/lib/permissions";

export const DELETE = api({ permission: "leads.edit" }, async (_req, ctx, p) => {
  const note = await db.note.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!note) throw new AppError("NOT_FOUND", "Note not found.");
  if (note.authorId !== ctx.user.id && !can(ctx.role, "leads.delete")) throw new AppError("FORBIDDEN", "You can only delete your own notes.");
  await db.note.delete({ where: { id: note.id } });
  return { ok: true };
});
