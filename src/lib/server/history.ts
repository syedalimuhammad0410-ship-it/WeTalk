import "./guard";
import { db } from "../db";
import { AppError } from "./errors";

/**
 * Search History: every lead search (Claude tasks, Business Finder searches, AutoProspect runs) with
 * when it ran and what it found, plus a time-stamped replay of the businesses found — enough to redraw
 * the search on a map (and record it as a video) long after it finished.
 */

export type HistoryKind = "claude" | "search" | "autoprospect";
export type HistoryRow = {
  kind: HistoryKind;
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  leads: number;
  withEmail: number;
  withPhone: number;
  cities: { name: string; count: number }[];
  liveHref: string;
};

type Lead = { id: string; email: string | null; phone: string | null; city: string | null };

function summarise(leads: Lead[]) {
  const cities = new Map<string, number>();
  for (const l of leads) if (l.city) cities.set(l.city, (cities.get(l.city) ?? 0) + 1);
  return {
    leads: leads.length,
    withEmail: leads.filter((l) => l.email).length,
    withPhone: leads.filter((l) => l.phone).length,
    cities: [...cities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count })),
  };
}

const LEAD = { id: true, email: true, phone: true, city: true } as const;
const windowEnd = (r: { finishedAt: Date | null }) => (r.finishedAt ? new Date(r.finishedAt.getTime() + 60_000) : new Date());

/** Businesses created by a Business Finder search: found by Google/OSM while it ran. */
const searchWhere = (workspaceId: string, r: { createdAt: Date; finishedAt: Date | null }) => ({
  workspaceId,
  source: { in: ["GOOGLE_PLACES" as const, "OPENSTREETMAP" as const] },
  discoveredAt: { gte: r.createdAt, lte: windowEnd(r) },
});

export async function searchHistory(workspaceId: string): Promise<HistoryRow[]> {
  const [tasks, runs, autos] = await Promise.all([
    db.claudeTask.findMany({ where: { workspaceId, type: "FIND_LEADS" }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.discoveryRun.findMany({ where: { workspaceId, automationRunId: null }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.automationRun.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const rows: HistoryRow[] = [];

  // Claude: the businesses it created, from the task's event log.
  const created = tasks.length ? await db.claudeTaskEvent.findMany({ where: { taskId: { in: tasks.map((t) => t.id) }, type: "BUSINESS_CREATED", businessId: { not: null } }, select: { taskId: true, businessId: true } }) : [];
  const leads = new Map((await db.business.findMany({ where: { workspaceId, id: { in: [...new Set(created.map((e) => e.businessId!))] } }, select: LEAD })).map((b) => [b.id, b]));
  for (const t of tasks) {
    const mine = created.filter((e) => e.taskId === t.id).map((e) => leads.get(e.businessId!)).filter((b): b is Lead => Boolean(b));
    rows.push({ kind: "claude", id: t.id, title: t.title, status: t.status, createdAt: t.createdAt, finishedAt: t.finishedAt, durationMs: t.finishedAt ? t.finishedAt.getTime() - (t.claimedAt ?? t.createdAt).getTime() : null, ...summarise(uniq(mine)), liveHref: `/claude/live/${t.id}` });
  }
  for (const r of runs) {
    const found = await db.business.findMany({ where: searchWhere(workspaceId, r), select: LEAD, take: 5000 });
    rows.push({ kind: "search", id: r.id, title: `Business Finder: ${r.queries.slice(0, 3).join(", ")} in ${r.locations.slice(0, 2).join("; ")}`, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, durationMs: r.finishedAt ? r.finishedAt.getTime() - r.createdAt.getTime() : null, ...summarise(found), liveHref: `/discover/live/${r.id}` });
  }
  for (const a of autos) {
    const items = await db.automationItem.findMany({ where: { runId: a.id }, select: { businessId: true } });
    const found = await db.business.findMany({ where: { workspaceId, id: { in: items.map((i) => i.businessId) } }, select: LEAD });
    rows.push({ kind: "autoprospect", id: a.id, title: `AutoProspect: ${a.name}`, status: a.status, createdAt: a.createdAt, finishedAt: a.finishedAt, durationMs: a.finishedAt ? a.finishedAt.getTime() - a.createdAt.getTime() : null, ...summarise(found), liveHref: `/autoprospect/${a.id}` });
  }
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

const uniq = (l: Lead[]) => [...new Map(l.map((b) => [b.id, b])).values()];

/** New leads per day (Toronto time), for the "leads found per day" chart. */
export async function leadsPerDay(workspaceId: string, days = 60) {
  const rows = await db.$queryRaw<{ day: string; leads: bigint; email: bigint; phone: bigint }[]>`
    SELECT to_char(("discoveredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') AS day,
           COUNT(*) AS leads, COUNT("email") AS email, COUNT("phone") AS phone
    FROM "Business"
    WHERE "workspaceId" = ${workspaceId} AND NOT "isDemo" AND "discoveredAt" > NOW() - make_interval(days => ${days})
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day, leads: Number(r.leads), withEmail: Number(r.email), withPhone: Number(r.phone) }));
}

export type ReplayPoint = { t: number; id: string; name: string; lat: number; lng: number; category: string | null; city: string | null; email: string | null; phone: string | null; website: string | null };

/** Every business a search found, in the order it was found (t = ms since the search started). */
export async function searchReplay(workspaceId: string, kind: HistoryKind, id: string) {
  const select = { id: true, name: true, latitude: true, longitude: true, category: true, city: true, email: true, phone: true, website: true, discoveredAt: true } as const;
  let title: string, startedAt: Date, finishedAt: Date | null, status: string;
  let found: { at: Date; b: { id: string; name: string; latitude: number | null; longitude: number | null; category: string | null; city: string | null; email: string | null; phone: string | null; website: string | null } }[];
  if (kind === "claude") {
    const t = await db.claudeTask.findFirst({ where: { id, workspaceId } });
    if (!t) throw new AppError("NOT_FOUND", "Search not found.");
    const ev = await db.claudeTaskEvent.findMany({ where: { taskId: id, type: "BUSINESS_CREATED", businessId: { not: null } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, businessId: true } });
    const biz = new Map((await db.business.findMany({ where: { workspaceId, id: { in: ev.map((e) => e.businessId!) } }, select })).map((b) => [b.id, b]));
    found = ev.map((e) => ({ at: e.createdAt, b: biz.get(e.businessId!)! })).filter((x) => x.b);
    ({ title, status } = t);
    startedAt = t.claimedAt ?? t.createdAt;
    finishedAt = t.finishedAt;
  } else if (kind === "search") {
    const r = await db.discoveryRun.findFirst({ where: { id, workspaceId } });
    if (!r) throw new AppError("NOT_FOUND", "Search not found.");
    const biz = await db.business.findMany({ where: searchWhere(workspaceId, r), select, orderBy: { discoveredAt: "asc" }, take: 5000 });
    found = biz.map((b) => ({ at: b.discoveredAt, b }));
    title = `Business Finder: ${r.queries.slice(0, 3).join(", ")} in ${r.locations.slice(0, 2).join("; ")}`;
    ({ status, createdAt: startedAt, finishedAt } = r);
  } else {
    const a = await db.automationRun.findFirst({ where: { id, workspaceId } });
    if (!a) throw new AppError("NOT_FOUND", "Search not found.");
    const items = await db.automationItem.findMany({ where: { runId: id }, select: { businessId: true } });
    const biz = await db.business.findMany({ where: { workspaceId, id: { in: items.map((i) => i.businessId) } }, select, orderBy: { discoveredAt: "asc" } });
    found = biz.map((b) => ({ at: b.discoveredAt, b }));
    title = `AutoProspect: ${a.name}`;
    ({ status, createdAt: startedAt, finishedAt } = a);
  }
  const t0 = Math.min(startedAt.getTime(), ...found.map((f) => f.at.getTime()));
  const points: ReplayPoint[] = [];
  const seen = new Set<string>();
  for (const { at, b } of found) {
    if (b.latitude == null || b.longitude == null || seen.has(b.id)) continue;
    seen.add(b.id);
    points.push({ t: at.getTime() - t0, id: b.id, name: b.name, lat: b.latitude, lng: b.longitude, category: b.category, city: b.city, email: b.email, phone: b.phone, website: b.website });
  }
  return { kind, id, title, status, startedAt: new Date(t0), finishedAt, points, withoutLocation: found.length - points.length };
}
export type SearchReplay = Awaited<ReturnType<typeof searchReplay>>;
