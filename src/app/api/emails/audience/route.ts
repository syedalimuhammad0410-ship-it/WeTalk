import { api } from "@/lib/server/api";
import { TYPE_GROUPS, emailAudience, emailSetup, listEmailRuns } from "@/lib/server/email/runs";

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => {
  const [leads, setup, runs] = await Promise.all([emailAudience(ctx.workspace.id), emailSetup(ctx.workspace.id), listEmailRuns(ctx.workspace.id)]);
  return { leads, setup, runs, groups: TYPE_GROUPS.map((g) => ({ id: g.id, label: g.label })) };
});
