import { api, parseBody } from "@/lib/server/api";
import { rateLimit } from "@/lib/server/ratelimit";
import { CreateEmailRunInput, createEmailRun, listEmailRuns } from "@/lib/server/email/runs";

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => ({ runs: await listEmailRuns(ctx.workspace.id) }));

export const POST = api({ permission: "emails.send" }, async (req, ctx) => {
  await rateLimit(`email-run:${ctx.workspace.id}`, 30, 3600, "Too many email runs started this hour.");
  const input = await parseBody(req, CreateEmailRunInput);
  return createEmailRun(ctx.workspace.id, ctx.user.id, input);
});
