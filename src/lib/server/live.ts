import "./guard";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "./errors";
import { ACTIVE, DONE, controlTask, isAny, shortId, taskBusinessIds, type TaskStats } from "./claude/tasks";
import { controlDiscoveryRun, zoneSummary } from "./discovery/run";
import { resolveAreaWithOsm } from "./discovery/geo";
import { MAP_POINT_SELECT, toPoint } from "./map";

/**
 * One shape for the full-screen live investigation view, whether Claude is researching a task
 * or a Business Finder search is running: status, counters, an event feed and map pins.
 */
export type LiveKind = "claude" | "search";
type Area = { center: [number, number]; bounds?: [[number, number], [number, number]] } | null;
type Row = Prisma.BusinessGetPayload<{ select: typeof MAP_POINT_SELECT }>;

async function pointsWithSummaries(rows: Row[]) {
  const ids = rows.map((r) => r.id);
  const ev = ids.length ? await db.businessEvidence.findMany({ where: { businessId: { in: ids }, field: { in: ["summary", "services"] } }, orderBy: { createdAt: "desc" }, select: { businessId: true, field: true, value: true } }) : [];
  const what = new Map<string, string>();
  for (const e of ev) if (!what.has(e.businessId) || e.field === "summary") what.set(e.businessId, e.value);
  return rows.map((r) => ({ ...toPoint(r), summary: what.get(r.id) ?? null }));
}

function areaFromPoints(points: { lat: number | null; lng: number | null }[]): Area {
  const p = points.filter((x) => x.lat != null && x.lng != null);
  if (!p.length) return null;
  const lats = p.map((x) => x.lat!);
  const lngs = p.map((x) => x.lng!);
  const b: [[number, number], [number, number]] = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  return { center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], bounds: b };
}

export async function liveState(workspaceId: string, kind: LiveKind, id: string) {
  return kind === "claude" ? claudeState(workspaceId, id) : searchState(workspaceId, id);
}

async function claudeState(workspaceId: string, id: string) {
  const task = await db.claudeTask.findFirst({ where: { id, workspaceId } });
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  const [events, ids] = await Promise.all([db.claudeTaskEvent.findMany({ where: { taskId: id }, orderBy: { createdAt: "desc" }, take: 200 }), taskBusinessIds(task)]);
  const rows = ids.length ? await db.business.findMany({ where: { workspaceId, id: { in: ids } }, select: MAP_POINT_SELECT }) : [];
  const points = await pointsWithSummaries(rows);
  const params = task.parameters as { area?: Area; locations?: string[] };
  let area = params.area ?? null;
  // "ANY" / "UNLIMITED" is not a place: let the map frame the businesses as they arrive instead of geocoding the word.
  if (!area && task.type === "FIND_LEADS" && params.locations?.[0] && !isAny(params.locations[0])) {
    // Centre the map on the search area the first time the live view opens.
    try {
      const a = await resolveAreaWithOsm(params.locations[0]);
      area = { center: [a.center.lng, a.center.lat], bounds: [[a.bounds.west, a.bounds.south], [a.bounds.east, a.bounds.north]] };
      await db.claudeTask.update({ where: { id }, data: { parameters: { ...(task.parameters as object), area } as Prisma.InputJsonValue } });
    } catch {
      /* the map falls back to the businesses found */
    }
  }
  const s = task.stats as TaskStats;
  return {
    kind: "claude" as const,
    id: task.id,
    shortId: shortId(task.id),
    title: task.title,
    status: task.status,
    progress: task.progress,
    message: task.progressMessage,
    createdAt: task.createdAt,
    startedAt: task.claimedAt,
    finishedAt: task.finishedAt,
    summary: task.summary,
    error: task.error,
    say: task.status === "QUEUED" ? `Run my WebScout task ${shortId(task.id)}` : null,
    stats: [
      { key: "found", label: "New leads", value: s.created ?? 0 },
      { key: "known", label: "Already in CRM", value: s.duplicates ?? 0 },
      { key: "emails", label: "Emails verified", value: s.contactsVerified ?? 0 },
      { key: "facts", label: "Facts", value: s.facts ?? 0 },
      { key: "drafts", label: "Email drafts", value: s.drafts ?? 0 },
    ],
    events: events.map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt, businessId: e.businessId })),
    points,
    area: area ?? areaFromPoints(points),
    controls: { pause: ACTIVE.includes(task.status), resume: task.status === "PAUSED", cancel: !DONE.includes(task.status) },
    detailsHref: `/claude/tasks/${task.id}`,
    backHref: "/claude",
  };
}

async function searchState(workspaceId: string, id: string) {
  const run = await db.discoveryRun.findFirst({ where: { id, workspaceId } });
  if (!run) throw new AppError("NOT_FOUND", "Search not found.");
  const until = run.finishedAt ? new Date(run.finishedAt.getTime() + 60_000) : undefined;
  const [rows, zones, bounds] = await Promise.all([
    db.business.findMany({ where: { workspaceId, source: { in: ["GOOGLE_PLACES", "OPENSTREETMAP"] }, discoveredAt: { gte: run.createdAt, ...(until ? { lte: until } : {}) } }, orderBy: { discoveredAt: "desc" }, take: 1500, select: MAP_POINT_SELECT }),
    zoneSummary(run.id),
    db.discoveryZone.aggregate({ where: { runId: run.id }, _min: { south: true, west: true }, _max: { north: true, east: true } }),
  ]);
  const points = await pointsWithSummaries(rows);
  const b = bounds._min.south != null ? ([[bounds._min.west!, bounds._min.south!], [bounds._max.east!, bounds._max.north!]] as [[number, number], [number, number]]) : null;
  const what = `${run.queries.slice(0, 4).join(", ")} in ${run.locations.slice(0, 3).join("; ")}`;
  const events = [
    { id: `start-${run.id}`, type: "TASK_CREATED", message: `Search started: ${what}`, createdAt: run.createdAt, businessId: null as string | null },
    ...rows.slice(0, 150).map((r) => ({ id: `b-${r.id}`, type: "BUSINESS_CREATED", message: `Found ${r.name}${r.category ? ` — ${r.category}` : ""}${r.city ? ` (${r.city})` : ""}`, createdAt: r.discoveredAt, businessId: r.id as string | null })),
    ...(run.message ? [{ id: `msg-${run.updatedAt.getTime()}`, type: run.status === "FAILED" ? "FAILED" : run.status === "PAUSED" ? "PAUSED" : "PROGRESS", message: run.message, createdAt: run.updatedAt, businessId: null }] : []),
    ...(run.finishedAt ? [{ id: `end-${run.id}`, type: run.status === "COMPLETED" ? "COMPLETED" : "CANCELLED", message: `Search ${run.status.toLowerCase()} — ${run.created} new businesses`, createdAt: run.finishedAt, businessId: null }] : []),
  ].sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt));
  const progress = run.target ? Math.min(100, Math.round((run.created / run.target) * 100)) : zones.total ? Math.round((zones.done / zones.total) * 100) : 0;
  return {
    kind: "search" as const,
    id: run.id,
    shortId: run.id.slice(-6),
    title: `Find ${what}`,
    status: run.status,
    progress: ["COMPLETED"].includes(run.status) ? 100 : progress,
    message: run.message ?? `${zones.done} of ${zones.total} map zones searched`,
    createdAt: run.createdAt,
    startedAt: run.createdAt,
    finishedAt: run.finishedAt,
    summary: null,
    error: run.error,
    say: null,
    stats: [
      { key: "found", label: "New businesses", value: run.created },
      { key: "known", label: "Already in CRM", value: run.duplicates },
      { key: "filtered", label: "Filtered out", value: run.filtered },
      { key: "zones", label: "Zones searched", value: zones.done },
    ],
    events,
    points,
    area: b ? { center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] as [number, number], bounds: b } : areaFromPoints(points),
    controls: { pause: ACTIVE.includes(run.status), resume: run.status === "PAUSED", cancel: !DONE.includes(run.status) },
    detailsHref: "/discover",
    backHref: "/discover",
  };
}

export async function liveControl(workspaceId: string, userId: string, kind: LiveKind, id: string, action: "pause" | "resume" | "cancel") {
  if (kind === "claude") await controlTask(workspaceId, userId, id, action);
  else await controlDiscoveryRun(workspaceId, id, action);
  return liveState(workspaceId, kind, id);
}

export type LiveStateT = Awaited<ReturnType<typeof liveState>>;
