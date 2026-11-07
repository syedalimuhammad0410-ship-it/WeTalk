import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { activatePlan, billingOverview } from "@/lib/server/billing";

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => billingOverview(ctx.workspace.id));

/** Switch to the Free plan (cancel a paid plan). Upgrades go through checkout. */
export const POST = api({ permission: "users.manage" }, async (req, ctx) => {
  await parseBody(req, z.object({ action: z.literal("downgrade") }));
  await activatePlan(ctx.workspace.id, ctx.user.id, "FREE", "MONTHLY", null);
  return { ok: true };
});
