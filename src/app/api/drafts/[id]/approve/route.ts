import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { approveDraft } from "@/lib/server/replies/actions";

export const POST = api({ permission: "drafts.approve" }, async (req, ctx, p) => {
  const b = await parseBody(req, z.object({ subject: z.string().max(300).optional(), body: z.string().max(20000).optional() }).default({})).catch(() => ({}) as { subject?: string; body?: string });
  const r = await approveDraft(ctx.workspace.id, p.id!, ctx.user.id, b);
  return { messageId: r.message.id, sandbox: r.sandbox };
});
