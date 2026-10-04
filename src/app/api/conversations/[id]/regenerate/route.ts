import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { regenerateDraft } from "@/lib/server/replies/analyze";

export const POST = api({ permission: "emails.compose" }, async (_req, ctx, p) => {
  const conv = await db.conversation.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!conv) throw new AppError("NOT_FOUND", "Conversation not found.");
  return regenerateDraft(ctx.workspace.id, conv.id);
});
export const maxDuration = 120;
