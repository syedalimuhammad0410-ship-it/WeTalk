import { api, parseBody } from "@/lib/server/api";
import { rateLimit } from "@/lib/server/ratelimit";
import { CreateTaskInput, createTask } from "@/lib/server/claude/tasks";
import { db } from "@/lib/db";

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => ({ tasks: await db.claudeTask.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { createdAt: "desc" }, take: 50 }) }));

export const POST = api({ permission: "discovery.run" }, async (req, ctx) => {
  await rateLimit(`claude-task:${ctx.workspace.id}`, 60, 3600, "Too many Claude tasks this hour.");
  const input = await parseBody(req, CreateTaskInput);
  return { task: await createTask(ctx.workspace.id, ctx.user.id, input) };
});
