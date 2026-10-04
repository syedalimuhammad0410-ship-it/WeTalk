import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { approveFollowUp } from "@/lib/server/followups";

export const POST = api({ permission: "emails.send" }, async (req, ctx, p) => {
  const b = await parseBody(req, z.object({ subject: z.string().max(300).optional(), body: z.string().max(20000).optional() }).default({})).catch(() => ({}));
  const r = await approveFollowUp(ctx.workspace.id, p.id!, ctx.user.id, b);
  return { messageId: r.message.id, sandbox: r.sandbox };
});
