import "../guard";
import * as z from "zod";
import type { EmailRun, EmailRunItem } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { getAi } from "../ai/client";
import { getSettings } from "../workspace";
import { enqueueJob } from "../jobs/queue";
import { generateOutreachDraft, writerLabel } from "./compose";
import { sendEmail } from "./send";

/**
 * Email runs: "email these businesses" from the Emails page, watched live.
 * Each business is written to (AI or template), then sent through sendEmail —
 * the one send path, so CASL eligibility, suppression, do-not-contact and the
 * workspace's hourly/daily/spacing limits all still apply. Waits for a send
 * slot are done by rescheduling the job, never by holding a worker.
 */

/** Business-type groups for the filter chips (first match wins, so order matters). */
export const TYPE_GROUPS = [
  { id: "bakery", label: "Bakeries & desserts", re: /baker|pastr|cake|dessert|patisserie|donut|cookie|sweet|chocolat|ice cream|gelato/i },
  { id: "food", label: "Restaurants & cafés", re: /restaurant|caf[eé]|coffee|bistro|grill|pizz|diner|\bbar\b|pub\b|eatery|kitchen|food|shawarma|sushi|ramen|noodle|\btea\b|bbq|burger|lounge|deli\b|catering|steak|yakitori|creperie/i },
  { id: "beauty", label: "Salons & beauty", re: /salon|hair|barber|nail|beauty|\bspa\b|lash|brow|aesthetic|tattoo/i },
  { id: "auto", label: "Auto", re: /auto|mechanic|tire|tyre|car wash|collision|body shop|garage|vehicle/i },
  { id: "health", label: "Health & clinics", re: /dent|physio|clinic|medical|chiro|pharm|doctor|health|acupunct|massage|optom|therap|rehab|wellness/i },
  { id: "trades", label: "Trades & home services", re: /landscap|plumb|clean|contract|roof|electric|hvac|lawn|paint|renovat|handyman|moving|pest|locksmith|construction|laundr/i },
  { id: "retail", label: "Shops & florists", re: /florist|flower|bridal|dress|boutique|shop|store|jewel|gift|cloth|retail|market|costume/i },
] as const;
export type TypeGroupId = (typeof TYPE_GROUPS)[number]["id"] | "other";
export function typeGroup(category: string | null | undefined, businessType?: string | null): TypeGroupId {
  const s = `${category ?? ""} ${businessType ?? ""}`;
  return TYPE_GROUPS.find((g) => g.re.test(s))?.id ?? "other";
}

export type AudienceLead = {
  id: string;
  name: string;
  category: string | null;
  group: TypeGroupId;
  city: string | null;
  website: string | null;
  email: string;
  /** CASL status of that address: ELIGIBLE (published by the business), NEEDS_REVIEW, INELIGIBLE. */
  eligibility: "ELIGIBLE" | "NEEDS_REVIEW" | "INELIGIBLE";
  reason: string | null;
  emailed: boolean;
  lastContactedAt: Date | null;
  doNotContact: boolean;
  suppressed: boolean;
};

/** Every lead with an email address, with what decides whether it can be emailed. */
export async function emailAudience(workspaceId: string): Promise<AudienceLead[]> {
  const rows = await db.business.findMany({
    where: { workspaceId, archived: false, OR: [{ email: { not: null } }, { contacts: { some: { email: { not: null } } } }] },
    select: {
      id: true, name: true, category: true, businessType: true, city: true, website: true, email: true, doNotContact: true, lastContactedAt: true,
      contacts: { where: { email: { not: null } }, select: { email: true, eligibility: true, eligibilityReason: true } },
    },
    orderBy: { name: "asc" },
    take: 5000,
  });
  const [emailed, suppression] = await Promise.all([
    db.emailMessage.findMany({ where: { workspaceId, direction: "OUTBOUND", kind: "OUTREACH", status: { in: ["SENT", "QUEUED"] }, businessId: { not: null } }, select: { businessId: true }, distinct: ["businessId"] }),
    db.suppressionEntry.findMany({ where: { workspaceId }, select: { value: true } }),
  ]);
  const sent = new Set(emailed.map((m) => m.businessId!));
  const blocked = new Set(suppression.map((s) => s.value.toLowerCase()));
  const rank = { ELIGIBLE: 0, NEEDS_REVIEW: 1, INELIGIBLE: 2 } as const;
  return rows.map((b) => {
    const contacts = b.contacts
      .map((c) => ({ email: c.email!.toLowerCase(), eligibility: (["ELIGIBLE", "INELIGIBLE"].includes(c.eligibility) ? c.eligibility : "NEEDS_REVIEW") as AudienceLead["eligibility"], reason: c.eligibilityReason }))
      .sort((a, c) => rank[a.eligibility] - rank[c.eligibility] || Number(c.email === b.email?.toLowerCase()) - Number(a.email === b.email?.toLowerCase()));
    const best = contacts[0] ?? { email: b.email!.toLowerCase(), eligibility: "NEEDS_REVIEW" as const, reason: "No eligibility check recorded for this address yet." };
    return {
      id: b.id, name: b.name, category: b.category, group: typeGroup(b.category, b.businessType), city: b.city, website: b.website,
      email: best.email, eligibility: best.eligibility, reason: best.reason ?? null,
      emailed: sent.has(b.id), lastContactedAt: b.lastContactedAt, doNotContact: b.doNotContact,
      suppressed: blocked.has(best.email) || blocked.has(`@${best.email.split("@")[1]}`),
    };
  });
}

export type Blocker = { code: string; title: string; detail: string; href: string };

/** What has to be fixed before WebScout may send, plus who sends and who writes. */
export async function emailSetup(workspaceId: string) {
  const [settings, account, ai] = await Promise.all([
    getSettings(workspaceId),
    db.emailAccount.findFirst({ where: { workspaceId, status: { not: "DISCONNECTED" } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    getAi(workspaceId).catch(() => null),
  ]);
  const blockers: Blocker[] = [];
  if (!account) blockers.push({ code: "NO_ACCOUNT", title: "Connect an email account", detail: "WebScout sends from your own Gmail account.", href: "/settings/email" });
  else if (account.status === "ERROR") blockers.push({ code: "ACCOUNT_ERROR", title: `Reconnect ${account.emailAddress}`, detail: account.lastError ? `Gmail stopped accepting WebScout's connection: ${account.lastError}` : "Gmail stopped accepting WebScout's connection.", href: "/settings/email" });
  if (!settings.compliance.physicalAddress.trim()) blockers.push({ code: "NO_ADDRESS", title: "Add your mailing address", detail: "Canada's anti-spam law (CASL) requires your mailing address in every sales email.", href: "/settings/compliance" });
  const c = settings.compliance;
  return {
    blockers,
    sender: account ? account.emailAddress : null,
    writer: ai && settings.automation.aiOutreachGeneration ? writerLabel(ai.model) : null,
    limits: { perDay: c.maxEmailsPerDay, perHour: c.maxEmailsPerHour, gapMinutes: c.minMinutesBetweenSends },
  };
}

export const CreateEmailRunInput = z.object({
  businessIds: z.array(z.string().min(5).max(40)).min(1, "Pick at least one business.").max(2000),
  useAi: z.boolean().default(true),
  includeNeedsReview: z.boolean().default(false),
  name: z.string().trim().max(120).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

const OPEN = ["QUEUED", "RUNNING", "PAUSED"];

export async function createEmailRun(workspaceId: string, userId: string | null, input: z.infer<typeof CreateEmailRunInput>) {
  const { blockers } = await emailSetup(workspaceId);
  if (blockers.length) throw new AppError("NOT_CONFIGURED", `${blockers.map((b) => b.title).join(" and ")} first — then start the run.`);
  const open = await db.emailRun.findFirst({ where: { workspaceId, status: { in: OPEN } }, select: { id: true, name: true, status: true } });
  if (open) throw new AppError("CONFLICT", `“${open.name}” is still ${open.status.toLowerCase()}. Finish or cancel it before starting another run.`, { runId: open.id });

  const audience = new Map((await emailAudience(workspaceId)).map((l) => [l.id, l]));
  const excluded = { alreadyEmailed: 0, notCleared: 0, needsReview: 0, doNotContact: 0, duplicateAddress: 0, notFound: 0 };
  const seen = new Set<string>();
  const picked: AudienceLead[] = [];
  for (const id of new Set(input.businessIds)) {
    const l = audience.get(id);
    if (!l) excluded.notFound++;
    else if (l.doNotContact || l.suppressed) excluded.doNotContact++;
    else if (l.emailed) excluded.alreadyEmailed++;
    else if (l.eligibility === "INELIGIBLE") excluded.notCleared++;
    else if (l.eligibility === "NEEDS_REVIEW" && !input.includeNeedsReview) excluded.needsReview++;
    else if (seen.has(l.email)) excluded.duplicateAddress++;
    else {
      seen.add(l.email);
      picked.push(l);
    }
  }
  if (!picked.length) throw new AppError("VALIDATION", "None of the selected businesses can be emailed: they were already emailed, aren't cleared under CASL, or are marked do-not-contact.", { excluded });

  const name = input.name || `${picked.length} ${picked.length === 1 ? "business" : "businesses"} · ${new Date().toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
  const run = await db.emailRun.create({
    data: {
      workspaceId, name, filters: (input.filters ?? {}) as object, useAi: input.useAi, includeNeedsReview: input.includeNeedsReview, total: picked.length, createdById: userId, message: "Starting…",
      items: { create: picked.map((l, i) => ({ businessId: l.id, email: l.email, position: i })) },
    },
  });
  await enqueueRunJob(run, new Date());
  await logActivity({ workspaceId, userId, action: "email_run.started", summary: `Email run started for ${picked.length} businesses`, details: { runId: run.id, excluded } });
  return { run: { id: run.id, total: picked.length }, excluded };
}

async function enqueueRunJob(run: Pick<EmailRun, "id" | "workspaceId" | "createdById">, runAfter: Date, exceptJobId?: string) {
  const pending = await db.job.findFirst({ where: { type: "EMAIL_RUN", status: { in: ["QUEUED", "RUNNING"] }, id: exceptJobId ? { not: exceptJobId } : undefined, payload: { path: ["runId"], equals: run.id } } });
  if (pending) {
    if (pending.status === "QUEUED" && pending.runAfter > runAfter) await db.job.update({ where: { id: pending.id }, data: { runAfter } });
    return;
  }
  await enqueueJob({ workspaceId: run.workspaceId, type: "EMAIL_RUN", label: "Email run", payload: { runId: run.id }, createdById: run.createdById, runAfter, maxAttempts: 3 });
}

/** How long until the workspace may send again (spacing, hourly and daily limits), and why. */
export async function nextSendSlot(workspaceId: string): Promise<{ ms: number; reason: string | null }> {
  const { compliance: c } = await getSettings(workspaceId);
  const now = Date.now();
  const base = { workspaceId, direction: "OUTBOUND" as const, status: { in: ["SENT" as const, "QUEUED" as const] } };
  const waitFor = async (windowMs: number, max: number) => {
    if (max <= 0) return 0;
    const inWindow = await db.emailMessage.findMany({ where: { ...base, createdAt: { gte: new Date(now - windowMs) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true }, take: max });
    return inWindow.length >= max ? inWindow[max - 1]!.createdAt.getTime() + windowMs - now + 1000 : 0;
  };
  const day = await waitFor(86400_000, c.maxEmailsPerDay);
  if (day > 0) return { ms: day, reason: `Daily limit reached (${c.maxEmailsPerDay} a day).` };
  const hour = await waitFor(3600_000, c.maxEmailsPerHour);
  if (hour > 0) return { ms: hour, reason: `Hourly limit reached (${c.maxEmailsPerHour} an hour).` };
  if (c.minMinutesBetweenSends > 0) {
    const last = await db.emailMessage.findFirst({ where: base, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const gap = last ? last.createdAt.getTime() + c.minMinutesBetweenSends * 60_000 - now + 1000 : 0;
    if (gap > 0) return { ms: gap, reason: `Waiting ${c.minMinutesBetweenSends} minute${c.minMinutesBetweenSends === 1 ? "" : "s"} between emails.` };
  }
  return { ms: 0, reason: null };
}

const SLICE_MS = 4 * 60_000;
const STOP_CODES = new Set(["INVALID_CREDENTIALS", "NOT_CONFIGURED"]);
const SKIP_CODES = new Set(["SUPPRESSED", "CONFLICT", "VALIDATION", "NOT_FOUND"]);

/** One job's worth of a run: send while slots are free, then reschedule itself for the next slot. */
export async function runEmailRunSlice(runId: string, jobId?: string) {
  const started = Date.now();
  let run = await db.emailRun.findUnique({ where: { id: runId } });
  if (!run || !["QUEUED", "RUNNING"].includes(run.status)) return { message: `Nothing to do (${run?.status.toLowerCase() ?? "run deleted"})` };
  if (run.status === "QUEUED") run = await db.emailRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() } });
  await recoverInFlight(run);
  let failuresInRow = 0;
  while (Date.now() - started < SLICE_MS) {
    const now = await db.emailRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (now?.status !== "RUNNING") return { message: `Run ${now?.status.toLowerCase() ?? "deleted"}` };
    const item = await db.emailRunItem.findFirst({ where: { runId, status: "PENDING" }, orderBy: { position: "asc" }, include: { business: { select: { name: true } } } });
    if (!item) return finishRun(run.id, "COMPLETED");
    const slot = await nextSendSlot(run.workspaceId);
    if (slot.ms > 0) {
      const at = new Date(Date.now() + slot.ms);
      await db.emailRun.update({ where: { id: runId }, data: { nextSendAt: at, message: `${slot.reason} Next: ${item.business.name}.` } });
      await enqueueRunJob(run, at, jobId);
      return { message: "Waiting for the next send slot" };
    }
    const outcome = await processItem(run, item);
    if (outcome === "stop") return { message: "Run paused" };
    if (typeof outcome === "number") {
      await enqueueRunJob(run, new Date(Date.now() + outcome), jobId);
      return { message: "Rate limited — rescheduled" };
    }
    failuresInRow = outcome === "failed" ? failuresInRow + 1 : 0;
    if (failuresInRow >= 3) {
      await db.emailRun.update({ where: { id: runId }, data: { status: "PAUSED", nextSendAt: null, message: "Paused after 3 failed emails in a row — check the errors below, then press Resume." } });
      await notify({ workspaceId: run.workspaceId, type: "EMAIL_FAILURE", title: "Email run paused", body: "3 emails in a row failed to send.", link: `/emails/runs/${runId}` });
      return { message: "Paused after repeated failures" };
    }
  }
  await enqueueRunJob(run, new Date(), jobId);
  return { message: "Continuing in the next slice" };
}

/** Items left mid-flight by a restart: sent ones are marked sent, the rest go back in the queue. */
async function recoverInFlight(run: EmailRun) {
  const stuck = await db.emailRunItem.findMany({ where: { runId: run.id, status: { in: ["WRITING", "SENDING"] } } });
  for (const it of stuck) {
    const sent = await db.emailMessage.findFirst({ where: { businessId: it.businessId, direction: "OUTBOUND", kind: "OUTREACH", status: "SENT", sentAt: { gte: it.startedAt ?? run.createdAt } }, select: { id: true } });
    if (sent) {
      await db.emailRunItem.update({ where: { id: it.id }, data: { status: "SENT", messageId: sent.id, finishedAt: new Date() } });
      await db.emailRun.update({ where: { id: run.id }, data: { sent: { increment: 1 } } });
    } else await db.emailRunItem.update({ where: { id: it.id }, data: { status: "PENDING" } });
  }
}

type Outcome = "sent" | "skipped" | "failed" | "stop" | number;

async function processItem(run: EmailRun, item: EmailRunItem & { business: { name: string } }): Promise<Outcome> {
  const claimed = await db.emailRunItem.updateMany({ where: { id: item.id, status: "PENDING" }, data: { status: "WRITING", startedAt: new Date(), error: null } });
  if (!claimed.count) return "skipped";
  await db.emailRun.update({ where: { id: run.id }, data: { nextSendAt: null, message: `Writing to ${item.business.name}…` } });
  let draft: Awaited<ReturnType<typeof generateOutreachDraft>>["draft"];
  try {
    const g = await generateOutreachDraft(run.workspaceId, item.businessId, run.createdById, { useAi: run.useAi, generalIntro: true, to: item.email });
    draft = g.draft;
    await db.emailRunItem.update({ where: { id: item.id }, data: { status: "SENDING", prompt: g.prompt, subject: draft.subject, body: draft.bodyText, writer: g.writer } });
    if (g.system && !run.instructions) await db.emailRun.update({ where: { id: run.id }, data: { instructions: g.system, writer: g.writer } });
  } catch (e) {
    return settle(run, item, e);
  }
  await db.emailRun.update({ where: { id: run.id }, data: { message: `Sending to ${item.business.name} (${item.email})…` } });
  try {
    const r = await sendEmail({ workspaceId: run.workspaceId, userId: run.createdById, to: item.email, subject: draft.subject, body: draft.bodyText, kind: "OUTREACH", businessId: item.businessId, campaignId: draft.campaignId, draftMessageId: draft.id, aiGenerated: draft.aiGenerated });
    await db.emailRunItem.update({ where: { id: item.id }, data: { status: "SENT", messageId: r.message.id, body: r.message.bodyText, finishedAt: new Date() } });
    await db.emailRun.update({ where: { id: run.id }, data: { sent: { increment: 1 }, message: `Sent to ${item.business.name}${r.sandbox ? " (sandbox — not delivered)" : ""}.` } });
    return "sent";
  } catch (e) {
    return settle(run, item, e);
  }
}

async function settle(run: EmailRun, item: EmailRunItem & { business: { name: string } }, e: unknown): Promise<Outcome> {
  const err = e as AppError;
  const reason = describeError(e).slice(0, 500);
  if (err.code === "RATE_LIMITED") {
    await db.emailRunItem.update({ where: { id: item.id }, data: { status: "PENDING" } });
    const retry = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
    return Math.max(15_000, (retry ?? 60) * 1000 + 1000);
  }
  if (STOP_CODES.has(err.code)) {
    await db.emailRunItem.update({ where: { id: item.id }, data: { status: "PENDING", error: reason } });
    await db.emailRun.update({ where: { id: run.id }, data: { status: "PAUSED", nextSendAt: null, message: `Paused: ${reason} Fix it, then press Resume.` } });
    await notify({ workspaceId: run.workspaceId, type: "EMAIL_FAILURE", title: "Email run paused", body: reason, link: `/emails/runs/${run.id}` });
    return "stop";
  }
  const skip = SKIP_CODES.has(err.code);
  await db.emailRunItem.update({ where: { id: item.id }, data: { status: skip ? "SKIPPED" : "FAILED", error: reason, finishedAt: new Date() } });
  await db.emailRun.update({ where: { id: run.id }, data: { ...(skip ? { skipped: { increment: 1 } } : { failed: { increment: 1 } }), message: `${skip ? "Skipped" : "Couldn't send to"} ${item.business.name}: ${reason}` } });
  return skip ? "skipped" : "failed";
}

async function finishRun(runId: string, status: "COMPLETED" | "CANCELLED") {
  const run = await db.emailRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), nextSendAt: null } });
  const summary = `${run.sent} sent, ${run.skipped} skipped, ${run.failed} failed.`;
  await db.emailRun.update({ where: { id: runId }, data: { message: `${status === "COMPLETED" ? "Done" : "Cancelled"} — ${summary}` } });
  if (status === "COMPLETED") await notify({ workspaceId: run.workspaceId, type: "JOB_COMPLETED", title: `Email run finished: ${run.name}`, body: summary, link: `/emails/runs/${runId}` });
  return { message: summary };
}

export async function controlEmailRun(workspaceId: string, runId: string, action: "pause" | "resume" | "cancel") {
  const run = await db.emailRun.findFirst({ where: { id: runId, workspaceId } });
  if (!run) throw new AppError("NOT_FOUND", "Email run not found.");
  if (action === "pause") {
    if (!["QUEUED", "RUNNING"].includes(run.status)) throw new AppError("CONFLICT", `This run is ${run.status.toLowerCase()}.`);
    await db.emailRun.update({ where: { id: runId }, data: { status: "PAUSED", nextSendAt: null, message: "Paused — nothing more is sent until you resume." } });
  } else if (action === "resume") {
    if (run.status !== "PAUSED") throw new AppError("CONFLICT", `This run is ${run.status.toLowerCase()}.`);
    const { blockers } = await emailSetup(workspaceId);
    if (blockers.length) throw new AppError("NOT_CONFIGURED", `${blockers.map((b) => b.title).join(" and ")} first — then resume.`);
    await db.emailRun.update({ where: { id: runId }, data: { status: "RUNNING", message: "Resuming…" } });
    await enqueueRunJob(run, new Date());
  } else {
    if (["COMPLETED", "CANCELLED"].includes(run.status)) throw new AppError("CONFLICT", `This run is already ${run.status.toLowerCase()}.`);
    await finishRun(runId, "CANCELLED");
  }
  return emailRunState(workspaceId, runId);
}

const ITEM_LIGHT = { id: true, position: true, status: true, email: true, subject: true, error: true, writer: true, finishedAt: true, business: { select: { id: true, name: true, category: true, city: true } } } as const;

/** Live state for the run window: light list of every business, full detail for the current and the selected one. */
export async function emailRunState(workspaceId: string, runId: string, selectedItemId?: string | null) {
  const run = await db.emailRun.findFirst({ where: { id: runId, workspaceId } });
  if (!run) throw new AppError("NOT_FOUND", "Email run not found.");
  const [items, setup] = await Promise.all([db.emailRunItem.findMany({ where: { runId }, orderBy: { position: "asc" }, select: ITEM_LIGHT }), emailSetup(workspaceId)]);
  const active = items.find((i) => i.status === "WRITING" || i.status === "SENDING");
  const lastDone = [...items].filter((i) => i.finishedAt).sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0];
  const currentId = active?.id ?? lastDone?.id ?? null;
  const full = (id: string | null | undefined) =>
    id ? db.emailRunItem.findFirst({ where: { id, runId }, include: { business: { select: { id: true, name: true, category: true, city: true, website: true, phone: true } } } }) : null;
  const [current, selected] = await Promise.all([full(currentId), selectedItemId && selectedItemId !== currentId ? full(selectedItemId) : null]);
  const left = items.filter((i) => ["PENDING", "WRITING", "SENDING"].includes(i.status)).length;
  return {
    run: { id: run.id, name: run.name, status: run.status, total: run.total, sent: run.sent, skipped: run.skipped, failed: run.failed, left, message: run.message, nextSendAt: run.nextSendAt, writer: run.writer, instructions: run.instructions, useAi: run.useAi, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt },
    items,
    current,
    selected,
    setup,
  };
}
export type EmailRunState = Awaited<ReturnType<typeof emailRunState>>;

export async function listEmailRuns(workspaceId: string) {
  return db.emailRun.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, status: true, total: true, sent: true, skipped: true, failed: true, createdAt: true, finishedAt: true } });
}
