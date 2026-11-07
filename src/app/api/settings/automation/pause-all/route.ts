import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { pauseAllAutomation } from "@/lib/server/automation/autoprospect";

/** Automation Control Center: pause or resume every automated process in the workspace. */
export const POST = api({ permission: "automation.manage" }, async (req, ctx) => {
  const b = await parseBody(req, z.object({ paused: z.boolean() }));
  await pauseAllAutomation(ctx.workspace.id, ctx.user.id, b.paused);
  return { ok: true };
});
