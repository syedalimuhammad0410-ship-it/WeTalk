import "../guard";
import * as z from "zod";
import type { EmailSchedule } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { getSettings } from "../workspace";
import { enqueueJob } from "../jobs/queue";
import { controlEmailRun, createEmailRun, emailAudience, emailSetup } from "./runs";

/**
 * The daily schedule (Emails → Schedule).
 * - Every day (or weekday), inside the sending window, email up to `perDay` cleared leads, spread evenly
 *   across the window, until none are left. A paused run is resumed as that day's batch.
 * - When fewer than a day's worth of cleared leads are left, spend `searchMinutes` finding new ones
 *   (an AutoProspect run that looks up public business emails), and keep going, indefinitely.
 *   Searches skip areas searched in the last 30 days, so each one covers new ground.
 * One EMAIL_SCHEDULE job per workspace drives it: it runs at each window start and when a search's time
 * is up, then schedules itself again. The job runner's maintenance re-creates it if it's ever lost.
 */

export const TZ = "America/Toronto";
export const DEFAULT_LOCATIONS = ["Milton, Ontario", "Toronto, Ontario", "Hamilton, Ontario", "Mississauga, Ontario", "Brampton, Ontario", "Oakville, Ontario", "Burlington, Ontario"];
export const DEFAULT_CATEGORIES = [
  "Restaurants", "Cafés", "Bakeries", "Hair salons", "Barbershops", "Nail salons", "Spas", "Dentists", "Chiropractors", "Physiotherapy",
  "Plumbers", "Electricians", "HVAC contractors", "Roofers", "Landscapers", "Cleaning services", "Auto repair", "Painters", "Movers", "Pet grooming",
  "Daycares", "Accountants", "Law offices", "Florists", "Photographers",
];
const OPEN = ["QUEUED", "RUNNING", "PAUSED"];
const ACTIVE_SEARCH = ["QUEUED", "RUNNING", "PAUSED"];
/** After its time is up a search stops finding businesses and finishes checking the ones it found; this long after, it is stopped outright. */
const HARD_STOP_MS = 30 * 60_000;
const RETRY_MS = 60 * 60_000;
const SEARCH_CAMPAIGN = "Daily schedule: new leads";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30");
export const ScheduleInput = z.object({
  enabled: z.boolean(),
  perDay: z.coerce.number().int().min(1, "At least 1 a day").max(500),
  startTime: hhmm,
  endTime: hhmm,
  weekdaysOnly: z.boolean().default(false),
  searchMinutes: z.coerce.number().int().min(0).max(240),
  locations: z.array(z.string().trim().min(2).max(200)).min(1, "Add at least one city").max(50),
  categories: z.array(z.string().trim().min(2).max(100)).min(1, "Add at least one business type").max(25),
  maxRequests: z.coerce.number().int().min(1).max(2000),
}).refine((v) => v.startTime < v.endTime, { message: "The sending window must end after it starts.", path: ["endTime"] });
export type ScheduleInputT = z.infer<typeof ScheduleInput>;

// ───────────── Toronto time ─────────────

function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
export const torontoDay = (d: Date) => parts(d).day;
/** The instant a Toronto wall-clock time happens on a Toronto date (DST-safe). */
export function torontoTime(day: string, time: string) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(t));
    const [py, pm, pd] = p.day.split("-").map(Number) as [number, number, number];
    t += want - Date.UTC(py, pm - 1, pd, p.hour, p.minute);
  }
  return new Date(t);
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
const ampm = (t: string) => { const [h, m] = t.split(":").map(Number) as [number, number]; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export const clock = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** The next sending window that hasn't had its batch yet (today's if it's still open). */
export function nextWindow(s: Pick<EmailSchedule, "startTime" | "endTime" | "weekdaysOnly" | "lastBatchDay">, now: Date) {
  const today = torontoDay(now);
  for (let i = 0; i < 8; i++) {
    const day = addDays(today, i);
    if (s.weekdaysOnly && isWeekend(day)) continue;
    if (day === s.lastBatchDay) continue;
    const start = torontoTime(day, s.startTime);
    const end = torontoTime(day, s.endTime);
    if (end.getTime() <= now.getTime()) continue;
    return { day, start, end };
  }
  return null;
}

// ───────────── Lead pool ─────────────

/** Cleared (CASL-eligible), not yet emailed, not blocked, not already waiting in an open run. */
export async function schedulePool(workspaceId: string) {
  const [leads, busy] = await Promise.all([
    emailAudience(workspaceId),
    db.emailRunItem.findMany({ where: { run: { workspaceId, status: { in: OPEN } }, status: { in: ["PENDING", "WRITING", "SENDING"] } }, select: { businessId: true } }),
  ]);
  const inRun = new Set(busy.map((b) => b.businessId));
  const seen = new Set<string>();
  return leads.filter((l) => {
    if (l.eligibility !== "ELIGIBLE" || l.emailed || l.doNotContact || l.suppressed || inRun.has(l.id) || seen.has(l.email)) return false;
    seen.add(l.email);
    return true;
  });
}

// ───────────── Settings ─────────────

export async function getSchedule(workspaceId: string) {
  const s = await db.emailSchedule.findUnique({ where: { workspaceId } });
  return s ?? { id: null, workspaceId, enabled: false, perDay: 40, startTime: "09:30", endTime: "16:30", weekdaysOnly: false, searchMinutes: 30, locations: DEFAULT_LOCATIONS, categories: DEFAULT_CATEGORIES, maxRequests: 40, lastBatchDay: null, lastSearchDay: null, lastRunId: null, searchRunId: null, searchStartedAt: null, message: null, nextAt: null, createdById: null, createdAt: null, updatedAt: null };
}

export async function saveSchedule(workspaceId: string, userId: string, input: ScheduleInputT) {
  const data = { ...input, locations: [...new Set(input.locations)], categories: [...new Set(input.categories)] };
  const before = await db.emailSchedule.findUnique({ where: { workspaceId } });
  const s = await db.emailSchedule.upsert({ where: { workspaceId }, create: { workspaceId, createdById: userId, ...data }, update: { ...data, createdById: before?.createdById ?? userId, ...(input.enabled ? {} : { nextAt: null, message: "Schedule is off." }) } });
  if (s.enabled) await queueTick(s, new Date());
  else await db.job.updateMany({ where: { workspaceId, type: "EMAIL_SCHEDULE", status: "QUEUED" }, data: { status: "CANCELLED", finishedAt: new Date(), message: "Schedule turned off" } });
  if (before?.enabled !== s.enabled) await logActivity({ workspaceId, userId, action: s.enabled ? "schedule.enabled" : "schedule.disabled", summary: s.enabled ? `Daily email schedule turned on: ${s.perDay} a day, ${s.startTime}–${s.endTime}${s.weekdaysOnly ? " on weekdays" : ""}` : "Daily email schedule turned off" });
  return scheduleState(workspaceId);
}

async function queueTick(s: Pick<EmailSchedule, "id" | "workspaceId" | "createdById">, at: Date) {
  const pending = await db.job.findFirst({ where: { workspaceId: s.workspaceId, type: "EMAIL_SCHEDULE", status: "QUEUED" }, orderBy: { runAfter: "asc" } });
  if (pending) await db.job.update({ where: { id: pending.id }, data: { runAfter: at } });
  else await enqueueJob({ workspaceId: s.workspaceId, type: "EMAIL_SCHEDULE", label: "Daily email schedule", runAfter: at, createdById: s.createdById, maxAttempts: 3 });
  await db.emailSchedule.update({ where: { id: s.id }, data: { nextAt: at } });
}

// ───────────── The tick ─────────────

export async function runScheduleTick(workspaceId: string, now = new Date()) {
  let s = await db.emailSchedule.findUnique({ where: { workspaceId } });
  if (!s?.enabled) return { message: "Schedule is off" };
  const { automation } = await getSettings(workspaceId);
  if (automation.automationPaused) {
    await db.emailSchedule.update({ where: { id: s.id }, data: { message: "Waiting: all automation is paused in the Automation Control Center." } });
    await queueTick(s, new Date(now.getTime() + RETRY_MS));
    return { message: "Automation paused" };
  }
  let retryAt: Date | null = null;
  const notes: string[] = [];

  // 1) A search whose time is up stops finding businesses (then finishes checking the ones it found).
  if (s.searchRunId && s.searchStartedAt) notes.push(...(await manageSearch(s, now)));

  // 2) The sending window closed: today's batch stops for the night.
  if (s.lastRunId && s.lastBatchDay && now >= torontoTime(s.lastBatchDay, s.endTime)) {
    const note = await closeForNight(s, now);
    if (note) notes.push(note);
  }

  // 3) Today's batch, inside the sending window.
  const win = nextWindow(s, now);
  if (win && win.day === torontoDay(now) && now >= win.start) {
    const r = await startBatch(s, win, now);
    notes.push(r.note);
    if (r.retry) retryAt = new Date(now.getTime() + r.retry);
  }
  s = (await db.emailSchedule.findUnique({ where: { id: s.id } }))!;

  // 4) Running low: find new leads (once a day at most).
  const left = (await schedulePool(workspaceId)).length;
  const searching = s.searchRunId ? await db.automationRun.findFirst({ where: { id: s.searchRunId, status: { in: ACTIVE_SEARCH } }, select: { id: true } }) : null;
  const today = torontoDay(now);
  if (left < s.perDay && s.searchMinutes > 0 && !searching && s.lastSearchDay !== today) notes.push(await startSearch(s, left, now));

  // 5) When to look again: the window's end, the next window, a search's stop time, or a retry.
  s = (await db.emailSchedule.findUnique({ where: { id: s.id } }))!;
  const next = nextTickAt(s, now, retryAt);
  const message = notes.filter(Boolean).join(" ") || s.message || null;
  await db.emailSchedule.update({ where: { id: s.id }, data: { message } });
  await queueTick(s, next);
  return { message: message ?? "Checked", next };
}

function nextTickAt(s: EmailSchedule, now: Date, retryAt: Date | null) {
  const times: number[] = [];
  if (s.lastRunId && s.lastBatchDay) {
    const end = torontoTime(s.lastBatchDay, s.endTime).getTime() + 5_000;
    if (end > now.getTime()) times.push(end);
  }
  const win = nextWindow(s, now);
  if (win) times.push(Math.max(win.start.getTime(), now.getTime() + 60_000));
  if (s.searchRunId && s.searchStartedAt) {
    const soft = s.searchStartedAt.getTime() + s.searchMinutes * 60_000;
    for (const t of [soft, soft + HARD_STOP_MS]) if (t > now.getTime()) { times.push(t + 5_000); break; }
  }
  if (retryAt) times.push(retryAt.getTime());
  return new Date(times.length ? Math.min(...times) : now.getTime() + 6 * RETRY_MS);
}

async function startBatch(s: EmailSchedule, win: { day: string; start: Date; end: Date }, now: Date): Promise<{ note: string; retry?: number }> {
  const ws = s.workspaceId;
  const done = (data: Partial<EmailSchedule>) => db.emailSchedule.update({ where: { id: s.id }, data: { lastBatchDay: win.day, ...data } });
  const spread = (n: number) => (n > 1 ? Math.max(30, Math.floor((win.end.getTime() - now.getTime()) / 1000 / n)) : 0);
  const open = await db.emailRun.findFirst({ where: { workspaceId: ws, status: { in: OPEN } }, orderBy: { createdAt: "desc" } });
  if (open?.scheduled && open.status !== "PAUSED") await closeForNight({ ...s, lastRunId: open.id }, now);
  else if (open) {
    const left = await db.emailRunItem.count({ where: { runId: open.id, status: { in: ["PENDING", "WRITING", "SENDING"] } } });
    if (open.status !== "PAUSED") return { note: `Waiting for “${open.name}” to finish (${left} left) before today's batch.`, retry: 30 * 60_000 };
    // A paused run becomes today's batch: resumed, spread across the window (paused again at its end if unfinished).
    try {
      await db.emailRun.update({ where: { id: open.id }, data: { gapSeconds: spread(Math.min(left, s.perDay)) } });
      await controlEmailRun(ws, open.id, "resume");
      await done({ lastRunId: open.id });
      await logActivity({ workspaceId: ws, userId: null, action: "schedule.batch", summary: `Daily schedule resumed “${open.name}” (${left} left) as today's batch` });
      return { note: `Today's batch: resumed “${open.name}”, ${left} left, spread until ${clock(win.end)}.` };
    } catch (e) {
      return blocked(s, e);
    }
  }
  const picks = (await schedulePool(ws)).slice(0, s.perDay);
  if (!picks.length) {
    await done({});
    return { note: "No cleared leads left to email today." };
  }
  try {
    const setup = await emailSetup(ws);
    const { run } = await createEmailRun(ws, s.createdById, { businessIds: picks.map((p) => p.id), useAi: Boolean(setup.writer), includeNeedsReview: false, name: `Daily batch · ${dayLabel(win.day)} · ${picks.length} ${picks.length === 1 ? "business" : "businesses"}` }, { gapSeconds: spread(picks.length), scheduled: true });
    await done({ lastRunId: run.id });
    const every = spread(run.total);
    return { note: `Today's batch: ${run.total} ${run.total === 1 ? "business" : "businesses"}${every ? `, about one every ${Math.max(1, Math.round(every / 60))} min until ${clock(win.end)}` : ""}.` };
  } catch (e) {
    return blocked(s, e);
  }
}

async function blocked(s: EmailSchedule, e: unknown) {
  const reason = describeError(e);
  // Tell the owner once per problem; the schedule keeps retrying every hour.
  if (!s.message?.includes(reason.slice(0, 60))) await notify({ workspaceId: s.workspaceId, type: "EMAIL_FAILURE", title: "Daily email schedule can't send yet", body: reason, link: "/emails?tab=schedule" });
  return { note: `Can't send today's batch yet: ${reason} Retrying every hour.`, retry: RETRY_MS };
}

/**
 * At the end of the window: a daily batch that isn't finished closes (what it didn't reach goes back into
 * the pool, for the next batch); a run someone started by hand is paused until the next window.
 */
async function closeForNight(s: EmailSchedule, now: Date) {
  const run = await db.emailRun.findFirst({ where: { id: s.lastRunId!, status: { in: ["QUEUED", "RUNNING"] } } });
  if (!run) return null;
  if (!run.scheduled) {
    await db.emailRun.update({ where: { id: run.id }, data: { status: "PAUSED", nextSendAt: null, message: `Paused for the night by the daily schedule; it carries on at ${ampm(s.startTime)}.` } });
    return `“${run.name}” paused for the night.`;
  }
  const moved = await db.emailRunItem.updateMany({ where: { runId: run.id, status: "PENDING" }, data: { status: "SKIPPED", error: "Carried over to the next day's batch", finishedAt: now } });
  const done = await db.emailRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: now, nextSendAt: null, skipped: { increment: moved.count } } });
  await db.emailRun.update({ where: { id: run.id }, data: { message: `Done for today: ${done.sent} sent${moved.count ? `; ${moved.count} carried over to the next batch` : ""}.` } });
  return moved.count ? `${moved.count} unsent from “${run.name}” carried over to the next batch.` : null;
}

async function startSearch(s: EmailSchedule, left: number, now: Date) {
  const ws = s.workspaceId;
  const { resolveIntegrationKey } = await import("../workspace");
  const google = await resolveIntegrationKey(ws, "GOOGLE_PLACES").catch(() => null);
  const { createAutoProspect, AutoProspectInput } = await import("../automation/autoprospect");
  try {
    if (!s.createdById) throw new AppError("VALIDATION", "Turn the schedule off and on again so it knows who runs it.");
    const campaign = (await db.campaign.findFirst({ where: { workspaceId: ws, name: SEARCH_CAMPAIGN }, select: { id: true } })) ?? (await db.campaign.create({ data: { workspaceId: ws, name: SEARCH_CAMPAIGN, status: "ACTIVE", description: "New leads found by the daily email schedule's searches." } }));
    const input = AutoProspectInput.parse({
      name: `Schedule search · ${dayLabel(torontoDay(now))}`,
      locations: s.locations.length ? s.locations : DEFAULT_LOCATIONS,
      categories: (s.categories.length ? s.categories : DEFAULT_CATEGORIES).slice(0, 15),
      keywords: (s.categories.length ? s.categories : DEFAULT_CATEGORIES).slice(15, 25),
      providers: google ? ["google_places", "openstreetmap"] : ["openstreetmap"],
      target: 5000,
      maxRequests: s.maxRequests,
      website: "has",
      smallOnly: true,
      requireEmail: true,
      steps: { contacts: true, audit: false, prompts: false, drafts: false },
      maxAiEmails: 0,
      concurrency: 3,
    });
    const run = await createAutoProspect(ws, s.createdById, input, { campaignId: campaign.id });
    await db.emailSchedule.update({ where: { id: s.id }, data: { searchRunId: run.id, searchStartedAt: now, lastSearchDay: torontoDay(now) } });
    return `Only ${left} cleared ${left === 1 ? "lead" : "leads"} left, so it's searching for new ones for ${s.searchMinutes} minutes.`;
  } catch (e) {
    await db.emailSchedule.update({ where: { id: s.id }, data: { lastSearchDay: torontoDay(now) } });
    return `Couldn't start the lead search: ${describeError(e)}`;
  }
}

async function manageSearch(s: EmailSchedule, now: Date): Promise<string[]> {
  const run = await db.automationRun.findUnique({ where: { id: s.searchRunId! } });
  if (!run || !ACTIVE_SEARCH.includes(run.status)) return [];
  const elapsed = now.getTime() - s.searchStartedAt!.getTime();
  const { controlAutoProspect } = await import("../automation/autoprospect");
  if (elapsed >= s.searchMinutes * 60_000 + HARD_STOP_MS) {
    await controlAutoProspect(s.workspaceId, run.id, "cancel");
    return [`Search “${run.name}” stopped.`];
  }
  if (elapsed >= s.searchMinutes * 60_000 && run.discoveryRunId) {
    const d = await db.discoveryRun.updateMany({ where: { id: run.discoveryRunId, status: { in: ACTIVE_SEARCH } }, data: { status: "COMPLETED", finishedAt: now, message: `Time's up: the daily schedule searches for ${s.searchMinutes} minutes.` } });
    // A search paused for its request budget has nothing left to find: let it finish checking what it found.
    if (run.status === "PAUSED") await controlAutoProspect(s.workspaceId, run.id, "resume").catch(() => undefined);
    if (d.count) return [`Search time's up: checking the businesses it found for public emails.`];
  }
  return [];
}

// ───────────── State for the Schedule tab ─────────────

export async function scheduleState(workspaceId: string) {
  const s = await getSchedule(workspaceId);
  const now = new Date();
  const [pool, runs, searches, needsReview] = await Promise.all([
    schedulePool(workspaceId),
    db.emailRun.findMany({ where: { workspaceId, scheduled: true }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, name: true, status: true, total: true, sent: true, failed: true, skipped: true, createdAt: true, nextSendAt: true } }),
    db.automationRun.findMany({ where: { workspaceId, name: { startsWith: "Schedule search" } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, name: true, status: true, counters: true, createdAt: true, finishedAt: true, message: true } }),
    emailAudience(workspaceId).then((l) => l.filter((x) => x.eligibility === "NEEDS_REVIEW" && !x.emailed && !x.doNotContact).length),
  ]);
  const win = s.enabled ? nextWindow({ ...s, lastBatchDay: s.lastBatchDay ?? null }, now) : null;
  return {
    schedule: { ...s, locations: s.locations.length ? s.locations : DEFAULT_LOCATIONS, categories: s.categories.length ? s.categories : DEFAULT_CATEGORIES },
    pool: pool.length,
    needsReview,
    daysLeft: s.perDay > 0 ? Math.floor(pool.length / s.perDay) : null,
    nextBatch: win ? { day: win.day, start: win.start, end: win.end } : null,
    runs,
    searches: searches.map((r) => {
      const c = (r.counters ?? {}) as { discovered?: number; eligible?: number; emailsDiscovered?: number; processed?: number };
      return { id: r.id, name: r.name, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, message: r.message, found: c.discovered ?? 0, withEmail: c.emailsDiscovered ?? 0, cleared: c.eligible ?? 0 };
    }),
  };
}
export type ScheduleState = Awaited<ReturnType<typeof scheduleState>>;
