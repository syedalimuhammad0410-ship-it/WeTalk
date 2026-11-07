import "../guard";
import * as z from "zod";
import type { DiscoveryRun, DiscoveryZone, Prisma } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { classifyBusinessType } from "../intel/classify-type";
import { normalizeWebsite, upsertBusiness } from "../leads";
import { getSettings, resolveIntegrationKey } from "../workspace";
import { brandKey, smallBusinessCheck } from "./small-business";
import { canSplit, cellKey, circleBounds, distanceKm, initialCellKm, parseLocations, resolveAreaWithGoogle, resolveAreaWithOsm, splitBounds, tileBounds, type Area, type Bounds } from "./geo";
import { PROVIDER_IDS, PROVIDERS, providerSettings, recordUsage, usageToday, type FoundBusiness, type ProviderId } from "./providers";

export const RunOptions = z.object({
  coverage: z.enum(["auto", "local", "regional", "provincial", "national"]).default("auto"),
  website: z.enum(["any", "has", "none"]).default("any"),
  hasPhone: z.boolean().default(false),
  minRating: z.coerce.number().min(0).max(5).default(0),
  openStatus: z.enum(["operational", "any"]).default("operational"),
  smallOnly: z.boolean().default(true),
  includeExisting: z.boolean().default(false),
  repeatSearches: z.boolean().default(false),
  excludeNames: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
  excludeDomains: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  autoAudit: z.boolean().default(false),
  /** Find publicly listed business emails for new businesses automatically. */
  findEmails: z.boolean().default(false),
  /** 0 = the whole named area (city, region, province, country); otherwise a radius around each location's centre. */
  radiusKm: z.coerce.number().min(0).max(1000).default(0),
  /** Filled in when zones are planned: the circles results must fall inside. */
  circles: z.array(z.object({ lat: z.number(), lng: z.number(), r: z.number() })).max(50).default([]),
});
export type RunOptionsT = z.infer<typeof RunOptions>;

export const DiscoveryRunInput = z.object({
  locations: z.array(z.string().trim().min(2).max(200)).min(1, "Add at least one location").max(50),
  queries: z.array(z.string().trim().min(2).max(100)).min(1, "Add at least one category or keyword").max(25),
  providers: z.array(z.enum(PROVIDER_IDS)).min(1, "Choose at least one data provider").default(["google_places"]),
  target: z.coerce.number().int().min(1).max(20000).default(200),
  maxRequests: z.coerce.number().int().min(1).max(50000).default(500),
  options: RunOptions.default({} as never),
  campaignId: z.string().nullable().optional(),
});
export type DiscoveryRunInputT = z.infer<typeof DiscoveryRunInput>;

const ACTIVE = ["QUEUED", "RUNNING"];
const isActiveRun = (s: string) => ACTIVE.includes(s);

/** Creates a run (zones are planned on its first slice). The caller enqueues the job. */
export async function createDiscoveryRun(workspaceId: string, userId: string | null, input: DiscoveryRunInputT, extra: { automationRunId?: string } = {}) {
  const { automation } = await getSettings(workspaceId);
  if (!automation.discoveryEnabled) throw new AppError("VALIDATION", "Business discovery is turned off in Settings → Automation Control Center.");
  if (input.campaignId && !(await db.campaign.findFirst({ where: { id: input.campaignId, workspaceId }, select: { id: true } }))) throw new AppError("NOT_FOUND", "Campaign not found.");
  const run = await db.discoveryRun.create({
    data: {
      workspaceId, createdById: userId, campaignId: input.campaignId ?? null, automationRunId: extra.automationRunId ?? null,
      locations: parseLocations(input.locations), queries: Array.from(new Set(input.queries.map((q) => q.trim()))), providers: input.providers,
      target: input.target, maxRequests: input.maxRequests, options: input.options as Prisma.InputJsonValue, message: "Waiting to start…",
    },
  });
  return run;
}

export async function enqueueDiscoveryRun(run: Pick<DiscoveryRun, "id" | "workspaceId" | "createdById">, label?: string) {
  const running = await db.job.findFirst({ where: { workspaceId: run.workspaceId, type: "DISCOVERY_RUN", status: { in: ["QUEUED", "RUNNING"] }, payload: { path: ["runId"], equals: run.id } }, select: { id: true } });
  if (running) return running;
  const { enqueueJob } = await import("../jobs/queue");
  return enqueueJob({ workspaceId: run.workspaceId, type: "DISCOVERY_RUN", label: label ?? "Large-area business discovery", payload: { runId: run.id }, createdById: run.createdById });
}

// ───────────── Planning ─────────────

function cellSizeFor(coverage: RunOptionsT["coverage"], b: Bounds, geoExpansion: boolean) {
  if (!geoExpansion || coverage === "local") return Number.POSITIVE_INFINITY;
  return { auto: initialCellKm(b), regional: 50, provincial: 100, national: 200 }[coverage];
}

async function resolveArea(workspaceId: string, location: string, preferGoogle: boolean): Promise<Area> {
  const key = preferGoogle ? await resolveIntegrationKey(workspaceId, "GOOGLE_PLACES").catch(() => null) : null;
  if (key) return resolveAreaWithGoogle(key.key, location);
  return resolveAreaWithOsm(location);
}

/** Splits every location into zones for every provider × query. Idempotent. */
export async function planZones(run: DiscoveryRun, only?: { locations?: string[]; queries?: string[] }) {
  const { automation } = await getSettings(run.workspaceId);
  const opts = RunOptions.parse(run.options ?? {});
  const locations = only?.locations ?? run.locations;
  const queries = only?.queries ?? run.queries;
  const notes: string[] = [];
  const circles = [...opts.circles];
  let planned = 0;
  for (const location of locations) {
    let area: Area;
    try {
      area = await resolveArea(run.workspaceId, location, run.providers.includes("google_places"));
    } catch (e) {
      notes.push(`${location}: ${describeError(e)}`);
      continue;
    }
    // Radius search: cover the circle around the location's centre (any size — large circles are tiled).
    let bounds = area.bounds;
    if (opts.radiusKm > 0) {
      bounds = circleBounds(area.center, opts.radiusKm);
      if (!circles.some((c) => c.lat === area.center.lat && c.lng === area.center.lng)) circles.push({ ...area.center, r: opts.radiusKm });
    }
    const tiles = tileBounds(bounds, cellSizeFor(opts.coverage, bounds, automation.geoExpansionEnabled));
    for (const provider of run.providers as ProviderId[]) {
      for (const query of queries) {
        const rows = tiles.map((b, i) => ({
          workspaceId: run.workspaceId, runId: run.id, provider, query, depth: 0, ...b,
          label: tiles.length > 1 ? `${location} — zone ${i + 1} of ${tiles.length}` : location,
        }));
        // Skip cells searched recently (unless the user asked to repeat searches).
        if (!opts.repeatSearches) {
          const recent = await db.discoverySearchHistory.findMany({ where: { workspaceId: run.workspaceId, provider, query, searchedAt: { gte: new Date(Date.now() - 30 * 86400_000) }, saturated: false, cellKey: { in: rows.map((r) => cellKey(r)) } }, select: { cellKey: true } });
          const skip = new Set(recent.map((r) => r.cellKey));
          for (const r of rows) if (skip.has(cellKey(r))) Object.assign(r, { status: "SKIPPED", error: "Searched in the last 30 days" });
        }
        const res = await db.discoveryZone.createMany({ data: rows, skipDuplicates: true });
        planned += res.count;
      }
    }
  }
  if (circles.length !== opts.circles.length) await db.discoveryRun.update({ where: { id: run.id }, data: { options: { ...opts, circles } as Prisma.InputJsonValue } });
  return { planned, notes };
}

// ───────────── Processing ─────────────

export type SliceResult = { state: "YIELD" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED"; message: string; createdIds: string[] };

function passesFilters(b: FoundBusiness, o: RunOptionsT, brands: Map<string, Set<string>>): string | null {
  if (o.openStatus === "operational" && b.operationalStatus && b.operationalStatus !== "OPERATIONAL") return "closed";
  if (o.minRating > 0 && b.rating != null && b.rating < o.minRating) return "rating";
  if (o.website === "has" && !b.website) return "website";
  if (o.website === "none" && b.website) return "website";
  if (o.hasPhone && !b.phone) return "phone";
  if (o.circles.length && b.latitude != null && b.longitude != null && !o.circles.some((c) => distanceKm({ lat: c.lat, lng: c.lng }, { lat: b.latitude!, lng: b.longitude! }) <= c.r)) return "outside radius";
  const lname = b.name.toLowerCase();
  if (o.excludeNames.some((n) => lname.includes(n.toLowerCase()))) return "excluded";
  const domain = normalizeWebsite(b.website)?.domain;
  if (domain && o.excludeDomains.some((d) => domain === d.toLowerCase().replace(/^www\./, "") || domain.endsWith(`.${d.toLowerCase()}`))) return "excluded";
  if (o.smallOnly) {
    if (b.chain) return "chain";
    const brand = brandKey(b.name);
    const set = brands.get(brand) ?? new Set<string>();
    set.add(b.sourceId ?? b.name);
    brands.set(brand, set);
    if (!smallBusinessCheck({ name: b.name, types: b.types, reviewCount: b.reviewCount ?? null }).ok || (brand.length > 2 && set.size > 1)) return "chain";
  }
  return null;
}

/** Links a business to the run's campaign / automation run; returns true if newly linked. */
async function attach(run: DiscoveryRun, businessId: string) {
  let added = false;
  if (run.campaignId) added = (await db.campaignLead.createMany({ data: [{ campaignId: run.campaignId, businessId }], skipDuplicates: true })).count > 0 || added;
  if (run.automationRunId) added = (await db.automationItem.createMany({ data: [{ workspaceId: run.workspaceId, runId: run.automationRunId, businessId }], skipDuplicates: true })).count > 0 || added;
  return added;
}

async function finish(runId: string, status: "COMPLETED" | "CANCELLED" | "FAILED" | "PAUSED", message: string) {
  await db.discoveryRun.update({ where: { id: runId }, data: { status, message, ...(status === "PAUSED" ? {} : { finishedAt: new Date() }) } });
}

/**
 * Processes zones until the deadline, the target, the request budget, a pause/cancel,
 * or the end of the work. Every zone and page is checkpointed, so a slice can stop
 * anywhere and the next one continues exactly where it left off.
 */
export async function processDiscoveryRun(runId: string, deadline: number, onProgress?: (run: DiscoveryRun) => Promise<void>): Promise<SliceResult> {
  const createdIds: string[] = [];
  const brands = new Map<string, Set<string>>();
  let run = await db.discoveryRun.findUnique({ where: { id: runId } });
  if (!run) return { state: "FAILED", message: "Run not found", createdIds };
  if (!isActiveRun(run.status)) return { state: run.status as SliceResult["state"], message: run.message ?? "", createdIds };
  run = await db.discoveryRun.update({ where: { id: runId }, data: { status: "RUNNING" } });
  let opts = RunOptions.parse(run.options ?? {});

  if (!(await db.discoveryZone.count({ where: { runId } }))) {
    const { planned, notes } = await planZones(run);
    if (!planned) {
      const msg = notes.length ? `Could not plan the search: ${notes.join(" ")}` : "Nothing to search: every zone was searched in the last 30 days (turn on “Repeat recent searches” to search again).";
      await finish(runId, notes.length ? "FAILED" : "COMPLETED", msg);
      return { state: notes.length ? "FAILED" : "COMPLETED", message: msg, createdIds };
    }
    if (notes.length) run = await db.discoveryRun.update({ where: { id: runId }, data: { message: `Some locations were skipped: ${notes.join(" ")}` } });
    // Planning recorded the radius circles: use them from the first result on.
    opts = RunOptions.parse((await db.discoveryRun.findUnique({ where: { id: runId }, select: { options: true } }))?.options ?? {});
  }

  const settingsByProvider = await providerSettings(run.workspaceId);
  for (;;) {
    run = (await db.discoveryRun.findUnique({ where: { id: runId } }))!;
    if (run.status === "PAUSED" || run.status === "CANCELLED") return { state: run.status, message: run.message ?? "", createdIds };
    const { automation } = await getSettings(run.workspaceId);
    if (automation.automationPaused) {
      await finish(runId, "PAUSED", "Paused: all automation is paused in the Automation Control Center.");
      return { state: "PAUSED", message: "All automation is paused.", createdIds };
    }
    if (run.found >= run.target) {
      const msg = `Target reached: ${run.found} businesses (${run.created} new). Use Continue discovery to find more.`;
      await finish(runId, "COMPLETED", msg);
      return { state: "COMPLETED", message: msg, createdIds };
    }
    if (run.requests >= run.maxRequests) {
      const msg = `Paused: the request budget (${run.maxRequests}) is used up. Raise it and press Continue to keep going.`;
      await finish(runId, "PAUSED", msg);
      return { state: "PAUSED", message: msg, createdIds };
    }
    if (Date.now() > deadline) return { state: "YIELD", message: run.message ?? "", createdIds };

    let zone = await db.discoveryZone.findFirst({ where: { runId, status: { in: ["RUNNING", "PENDING"] } }, orderBy: [{ status: "desc" }, { depth: "asc" }, { id: "asc" }] });
    if (!zone) {
      const retry = await db.discoveryZone.updateMany({ where: { runId, status: "FAILED", attempts: { lt: 3 } }, data: { status: "PENDING" } });
      if (retry.count) continue;
      const failed = await db.discoveryZone.count({ where: { runId, status: "FAILED" } });
      const msg = `Finished searching every zone: ${run.found} businesses (${run.created} new, ${run.duplicates} already known)${failed ? `; ${failed} zone(s) failed — use Retry failed zones` : ""}.`;
      await finish(runId, "COMPLETED", msg);
      return { state: "COMPLETED", message: msg, createdIds };
    }

    const provider = PROVIDERS[zone.provider as ProviderId];
    const ps = settingsByProvider[zone.provider as ProviderId];
    if (!ps?.enabled) {
      await db.discoveryZone.update({ where: { id: zone.id }, data: { status: "SKIPPED", error: `${provider.label} is disabled in provider settings` } });
      continue;
    }
    if ((await usageToday(run.workspaceId, provider.id)) >= ps.dailyRequestLimit) {
      const msg = `Paused: today's ${provider.label} limit (${ps.dailyRequestLimit} requests) is reached. Resume tomorrow or raise the limit in provider settings.`;
      await finish(runId, "PAUSED", msg);
      return { state: "PAUSED", message: msg, createdIds };
    }

    zone = await db.discoveryZone.update({ where: { id: zone.id }, data: { status: "RUNNING" } });
    const bounds: Bounds = { south: zone.south, west: zone.west, north: zone.north, east: zone.east };
    try {
      const page = await provider.search(run.workspaceId, zone.query, bounds, zone.pageToken);
      await recordUsage(run.workspaceId, provider.id, { requests: 1, results: page.items.length });
      const inc = { found: 0, created: 0, duplicates: 0, filtered: 0 };
      let zoneCreated = 0;
      for (const item of page.items) {
        if (passesFilters(item, opts, brands)) { inc.filtered++; continue; }
        const res = await upsertBusiness(run.workspaceId, item, run.createdById);
        if (res.created) {
          inc.created++;
          zoneCreated++;
          createdIds.push(res.business.id);
          const t = classifyBusinessType({ googleTypes: item.types, category: item.category, name: item.name });
          await db.business.update({ where: { id: res.business.id }, data: { businessType: t.playbook.id, businessTypeConfidence: t.confidence } });
          await attach(run, res.business.id);
          inc.found++;
        } else {
          inc.duplicates++;
          if (opts.includeExisting && (await attach(run, res.business.id))) inc.found++;
        }
      }
      const pages = zone.pages + 1;
      const results = zone.results + page.items.length;
      const more = Boolean(page.nextPageToken) && pages < provider.maxPages;
      let status = "RUNNING";
      if (!more) {
        const saturated = results >= provider.saturatedAt || (Boolean(page.nextPageToken) && pages >= provider.maxPages);
        if (saturated && canSplit(bounds, zone.depth)) {
          status = "SPLIT";
          await createChildren(zone, bounds);
        } else status = "DONE";
        await db.discoverySearchHistory.upsert({
          where: { workspaceId_provider_query_cellKey: { workspaceId: run.workspaceId, provider: zone.provider, query: zone.query, cellKey: cellKey(bounds) } },
          create: { workspaceId: run.workspaceId, provider: zone.provider, query: zone.query, cellKey: cellKey(bounds), results, saturated },
          update: { results, saturated, searchedAt: new Date() },
        });
      }
      await db.discoveryZone.update({ where: { id: zone.id }, data: { status, pages, results, created: { increment: zoneCreated }, pageToken: more ? page.nextPageToken : null, error: null } });
      run = await db.discoveryRun.update({
        where: { id: runId },
        data: {
          requests: { increment: 1 }, found: { increment: inc.found }, created: { increment: inc.created }, duplicates: { increment: inc.duplicates }, filtered: { increment: inc.filtered },
          message: `Searching “${zone.query}” in ${zone.label}${zone.depth ? ` (detail level ${zone.depth + 1})` : ""}…`,
        },
      });
      if (onProgress) await onProgress(run);
    } catch (e) {
      const err = e as AppError;
      await recordUsage(run.workspaceId, provider.id, { requests: 1, error: e });
      if (err.code === "VALIDATION" && zone.pageToken) {
        // Page tokens expire: search the zone again from its first page.
        await db.discoveryZone.update({ where: { id: zone.id }, data: { pageToken: null, pages: 0, results: 0, status: "PENDING" } });
      } else if (err.code === "VALIDATION" && canSplit(bounds, zone.depth)) {
        await db.discoveryZone.update({ where: { id: zone.id }, data: { status: "SPLIT", error: describeError(e).slice(0, 300) } });
        await createChildren(zone, bounds);
      } else if (err.code === "INVALID_CREDENTIALS" || err.code === "QUOTA_EXCEEDED" || err.code === "NOT_CONFIGURED") {
        await db.discoveryZone.update({ where: { id: zone.id }, data: { status: "PENDING" } });
        const msg = `Paused: ${describeError(e)} Fix it, then press Resume — finished zones are kept.`;
        await finish(runId, "PAUSED", msg);
        await notify({ workspaceId: run.workspaceId, type: "API_FAILURE", title: "Large-area discovery paused", body: describeError(e), link: "/discover" });
        return { state: "PAUSED", message: msg, createdIds };
      } else {
        const attempts = zone.attempts + 1;
        await db.discoveryZone.update({ where: { id: zone.id }, data: { attempts, status: attempts >= 3 ? "FAILED" : "PENDING", error: describeError(e).slice(0, 500) } });
      }
      await db.discoveryRun.update({ where: { id: runId }, data: { requests: { increment: 1 }, message: `Zone ${zone.label}: ${describeError(e).slice(0, 200)}` } });
      if (err.code === "RATE_LIMITED") await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function createChildren(zone: DiscoveryZone, b: Bounds) {
  const kids = splitBounds(b);
  await db.discoveryZone.createMany({
    data: kids.map((k, i) => ({ workspaceId: zone.workspaceId, runId: zone.runId, provider: zone.provider, query: zone.query, depth: zone.depth + 1, label: `${zone.label.replace(/ › part [\d.]+$/, "")} › part ${i + 1}`, ...k })),
    skipDuplicates: true,
  });
}

// ───────────── Controls ─────────────

export async function zoneSummary(runId: string) {
  const groups = await db.discoveryZone.groupBy({ by: ["status"], where: { runId }, _count: true });
  const n = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;
  return { total: groups.reduce((s, g) => s + g._count, 0) - n("SPLIT"), done: n("DONE") + n("SKIPPED"), pending: n("PENDING") + n("RUNNING"), failed: n("FAILED"), split: n("SPLIT") };
}

export async function controlDiscoveryRun(workspaceId: string, runId: string, action: "pause" | "resume" | "cancel" | "retry_failed" | "continue", extra: { addTarget?: number; addRequests?: number; addQueries?: string[]; addLocations?: string[] } = {}) {
  const run = await db.discoveryRun.findFirst({ where: { id: runId, workspaceId } });
  if (!run) throw new AppError("NOT_FOUND", "Discovery run not found.");
  if (run.automationRunId && action !== "pause") throw new AppError("VALIDATION", "This search belongs to an AutoProspect run — control it from that run's page.");
  switch (action) {
    case "pause":
      if (!isActiveRun(run.status)) throw new AppError("CONFLICT", `This search is ${run.status.toLowerCase()}.`);
      await db.discoveryRun.update({ where: { id: runId }, data: { status: "PAUSED", message: "Paused. Finished zones are kept — press Resume to continue." } });
      return;
    case "cancel":
      await db.discoveryRun.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: new Date(), message: "Cancelled. Businesses already found are kept." } });
      return;
    case "retry_failed":
      await db.discoveryZone.updateMany({ where: { runId, status: "FAILED" }, data: { status: "PENDING", attempts: 0 } });
      break;
    case "continue": {
      const data: Prisma.DiscoveryRunUpdateInput = {};
      if (extra.addTarget) data.target = run.target + extra.addTarget;
      if (extra.addRequests) data.maxRequests = run.maxRequests + extra.addRequests;
      if (extra.addQueries?.length) data.queries = Array.from(new Set([...run.queries, ...extra.addQueries]));
      if (extra.addLocations?.length) data.locations = Array.from(new Set([...run.locations, ...parseLocations(extra.addLocations)]));
      const updated = await db.discoveryRun.update({ where: { id: runId }, data });
      // New keywords cover every location; new locations get every keyword.
      if (extra.addQueries?.length) await planZones(updated, { queries: extra.addQueries });
      if (extra.addLocations?.length) await planZones(updated, { locations: parseLocations(extra.addLocations) });
      break;
    }
    case "resume":
      if (run.status === "COMPLETED") throw new AppError("CONFLICT", "This search is finished — use Continue discovery to find more.");
      break;
  }
  const resumed = await db.discoveryRun.update({ where: { id: runId }, data: { status: "QUEUED", finishedAt: null, message: "Continuing…" } });
  await enqueueDiscoveryRun(resumed);
}

/** Job handler body: one time-boxed slice, re-enqueued until the run stops. */
export async function runDiscoverySlice(runId: string, sliceMs = 240_000) {
  const r = await processDiscoveryRun(runId, Date.now() + sliceMs);
  const run = await db.discoveryRun.findUnique({ where: { id: runId } });
  if (!run) return r;
  const opts = RunOptions.parse(run.options ?? {});
  if (r.createdIds.length && !run.automationRunId && (opts.autoAudit || opts.findEmails)) {
    const { enqueueJob } = await import("../jobs/queue");
    if (opts.findEmails) await enqueueJob({ workspaceId: run.workspaceId, type: "CONTACT_DISCOVERY", label: `Find public emails for ${r.createdIds.length} new businesses`, payload: { businessIds: r.createdIds }, createdById: run.createdById });
    if (opts.autoAudit) await enqueueJob({ workspaceId: run.workspaceId, type: "WEBSITE_AUDIT", label: `Analyse ${r.createdIds.length} new businesses`, payload: { businessIds: r.createdIds }, createdById: run.createdById });
  }
  if (r.state === "YIELD") await enqueueDiscoveryRun(run);
  else if (r.state === "COMPLETED" && !run.automationRunId) {
    await notify({ workspaceId: run.workspaceId, type: "JOB_COMPLETED", title: "Large-area discovery finished", body: r.message, link: run.campaignId ? `/leads?campaignId=${run.campaignId}` : "/leads?sort=newest" });
    await logActivity({ workspaceId: run.workspaceId, userId: run.createdById, action: "discovery.completed", summary: r.message });
  }
  return { ...r, createdIds: r.createdIds.length };
}
