import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { billingOverview, downgradeToFree } from "@/lib/server/billing";

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => billingOverview(ctx.workspace.id));

/** Switch to the Free plan (cancels a PayPal subscription so no further payments are taken). Upgrades go through checkout. */
export const POST = api({ permission: "users.manage" }, async (req, ctx) => {
  await parseBody(req, z.object({ action: z.literal("downgrade") }));
  await downgradeToFree(ctx.workspace.id, ctx.user.id);
  return { ok: true };
});
