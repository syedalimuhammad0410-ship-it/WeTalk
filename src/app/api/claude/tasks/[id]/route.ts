import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { controlTask, taskBusinessIds } from "@/lib/server/claude/tasks";
import { MAP_POINT_SELECT, toPoint } from "@/lib/server/map";

export const GET = api({ permission: "leads.view" }, async (_req, ctx, p) => {
  const task = await db.claudeTask.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  const [events, ids] = await Promise.all([db.claudeTaskEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" }, take: 300 }), taskBusinessIds(task)]);
  const businesses = ids.length ? await db.business.findMany({ where: { workspaceId: ctx.workspace.id, id: { in: ids } }, select: MAP_POINT_SELECT }) : [];
  return { task, events, points: businesses.map(toPoint) };
});

export const PATCH = api({ permission: "discovery.run" }, async (req, ctx, p) => {
  const b = await parseBody(req, z.object({ action: z.enum(["pause", "resume", "cancel", "retry"]) }));
  return { task: await controlTask(ctx.workspace.id, ctx.user.id, p.id!, b.action) };
});
