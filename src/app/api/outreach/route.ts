import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { approveOutreach, rejectOutreach } from "@/lib/server/outreach";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), messageIds: z.array(z.string()).min(1).max(500), confirmCount: z.number().int() }),
  z.object({ action: z.literal("reject"), messageIds: z.array(z.string()).min(1).max(500) }),
]);

/** Outreach queue decisions: approve (queues sending within limits) or reject (deletes the draft). */
export const POST = api({ permission: "drafts.approve" }, async (req, ctx) => {
  const b = await parseBody(req, Body);
  if (b.action === "approve") {
    assertCan(ctx, "emails.send");
    return approveOutreach(ctx.workspace.id, ctx.user.id, b.messageIds, b.confirmCount);
  }
  return rejectOutreach(ctx.workspace.id, ctx.user.id, b.messageIds);
});
