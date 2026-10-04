import { api } from "@/lib/server/api";
import { rejectDraft } from "@/lib/server/replies/actions";

export const POST = api({ permission: "drafts.approve" }, async (_req, ctx, p) => {
  await rejectDraft(ctx.workspace.id, p.id!, ctx.user.id);
  return { ok: true };
});
