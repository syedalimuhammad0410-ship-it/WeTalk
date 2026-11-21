import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { taskBusinessIds } from "@/lib/server/claude/tasks";
import { MAP_POINT_SELECT, toPoint } from "@/lib/server/map";
import { TaskView } from "@/components/claude/task-view";

export const metadata = { title: "Claude task" };
export const dynamic = "force-dynamic";

export default async function ClaudeTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const task = await db.claudeTask.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!task) notFound();
  const [events, ids] = await Promise.all([db.claudeTaskEvent.findMany({ where: { taskId: id }, orderBy: { createdAt: "desc" }, take: 300 }), taskBusinessIds(task)]);
  const businesses = ids.length ? await db.business.findMany({ where: { workspaceId: ctx.workspace.id, id: { in: ids } }, select: MAP_POINT_SELECT }) : [];
  return <TaskView initial={JSON.parse(JSON.stringify({ task, events, points: businesses.map(toPoint) }))} canControl={ctx.can("discovery.run")} />;
}
