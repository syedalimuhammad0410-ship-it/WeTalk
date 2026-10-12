import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { runConfirmedAction } from "@/lib/server/assistant/agent";
import { logActivity } from "@/lib/server/activity";

/** Runs an action the assistant proposed, after the user clicked Confirm. Permissions are re-checked. */
export const POST = api({}, async (req, ctx) => {
  const { tool, args } = await parseBody(req, z.object({ tool: z.string().max(60), args: z.unknown() }));
  const r = await runConfirmedAction(ctx, { tool, args });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "assistant.confirmed", summary: `Confirmed assistant action: ${tool}` });
  return r;
});
