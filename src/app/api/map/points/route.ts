import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseQuery } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { MAP_POINT_SELECT, toPoint } from "@/lib/server/map";

/** Pins for the live map: businesses found by a Business Finder search, or the most recent leads. */
export const GET = api({ permission: "leads.view" }, async (req, ctx) => {
  const q = parseQuery(req, z.object({ run: z.string().optional(), claude: z.string().optional(), limit: z.coerce.number().int().min(1).max(2000).default(500) }));
  const ws = ctx.workspace.id;
  if (q.run) {
    const run = await db.discoveryRun.findFirst({ where: { id: q.run, workspaceId: ws } });
    if (!run) throw new AppError("NOT_FOUND", "Search not found.");
    const until = run.finishedAt ? new Date(run.finishedAt.getTime() + 60_000) : undefined;
    const rows = await db.business.findMany({
      where: { workspaceId: ws, source: { in: ["GOOGLE_PLACES", "OPENSTREETMAP"] }, discoveredAt: { gte: run.createdAt, ...(until ? { lte: until } : {}) }, latitude: { not: null } },
      orderBy: { discoveredAt: "desc" }, take: q.limit, select: MAP_POINT_SELECT,
    });
    return { points: rows.map(toPoint), live: ["QUEUED", "RUNNING"].includes(run.status) };
  }
  const rows = await db.business.findMany({ where: { workspaceId: ws, archived: false, latitude: { not: null }, ...(q.claude ? { source: "CLAUDE_RESEARCH" as const } : {}) }, orderBy: { discoveredAt: "desc" }, take: q.limit, select: MAP_POINT_SELECT });
  return { points: rows.map(toPoint), live: false };
});
