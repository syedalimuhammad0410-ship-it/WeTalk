import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { setConversationControl } from "@/lib/server/replies/actions";

export const POST = api({}, async (req, ctx, p) => {
  const { action } = await parseBody(req, z.object({ action: z.enum(["PAUSE_AI", "RESUME_AI", "TAKE_OVER", "RELEASE", "DO_NOT_CONTACT", "MARK_READ", "CLOSE", "REOPEN"]) }));
  if (action !== "MARK_READ") assertCan(ctx, "emails.send");
  await setConversationControl(ctx.workspace.id, p.id!, ctx.user.id, action);
  return { ok: true };
});
