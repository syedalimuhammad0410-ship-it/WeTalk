import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/ratelimit";
import { AutoProspectInput, createAutoProspect, listAutoProspects } from "@/lib/server/automation/autoprospect";

export const POST = api({ permission: "discovery.run" }, async (req, ctx) => {
  assertCan(ctx, "campaigns.manage");
  await rateLimit(`autoprospect:${ctx.workspace.id}`, 20, 3600, "Too many AutoProspect runs started this hour.");
  const input = await parseBody(req, AutoProspectInput);
  const run = await createAutoProspect(ctx.workspace.id, ctx.user.id, input);
  return { id: run.id };
});

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => ({ runs: await listAutoProspects(ctx.workspace.id) }));
