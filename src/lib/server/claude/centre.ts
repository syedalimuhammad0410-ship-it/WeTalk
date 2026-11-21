import "../guard";
import { db } from "../../db";
import { pauseAllAutomation } from "../automation/autoprospect";
import { publicConnection } from "./connections";
import { isGloballyPaused } from "./tasks";

/** Everything the Claude Command Centre shows: connection status, tasks, the live feed and counts. */
export async function commandCentre(workspaceId: string) {
  const [connections, tasks, events, paused, counts] = await Promise.all([
    db.claudeConnection.findMany({ where: { workspaceId, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    db.claudeTask.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.claudeTaskEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 60, include: { task: { select: { title: true } } } }),
    isGloballyPaused(workspaceId),
    db.claudeTask.groupBy({ by: ["status"], where: { workspaceId }, _count: true }),
  ]);
  const conns = connections.map(publicConnection);
  const state = conns.some((c) => c.state === "active") ? "active" : conns.some((c) => c.state === "ready") ? "ready" : conns.length ? "idle" : "not_connected";
  return { state, paused, connections: conns, tasks, events, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number> };
}

/** Emergency stop: pauses every Claude task, search and AutoProspect run, and automated sending. */
export const stopEverything = (workspaceId: string, userId: string) => pauseAllAutomation(workspaceId, userId, true);
export const resumeEverything = (workspaceId: string, userId: string) => pauseAllAutomation(workspaceId, userId, false);
