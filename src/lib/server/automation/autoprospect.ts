import "../guard";
import * as z from "zod";
import type { AutomationItem, AutomationRun, AutomationSettings, ComplianceSettings, Prisma } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { getSettings } from "../workspace";
import { runWebsiteAudit } from "../audit/service";
import { generatePrompt } from "../prompts/service";
import { generateOutreachDraft } from "../email/compose";
import { discoverContacts, recipientEligibility } from "../contacts/discover";
import { createDiscoveryRun, processDiscoveryRun, zoneSummary } from "../discovery/run";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "../discovery/providers";

export const AutoProspectInput = z.object({
  name: z.string().trim().min(2, "Name the campaign").max(120),
  locations: z.array(z.string().trim().min(2).max(200)).min(1, "Add at least one location").max(50),
  categories: z.array(z.string().trim().min(2).max(100)).min(1, "Add at least one business category").max(15),
  keywords: z.array(z.string().trim().min(2).max(100)).max(15).default([]),
  providers: z.array(z.enum(PROVIDER_IDS)).min(1).default(["google_places"]),
  target: z.coerce.number().int().min(1).max(20000).default(200),
  maxRequests: z.coerce.number().int().min(1).max(50000).default(300),
  budgetCents: z.coerce.number().int().min(0).max(10_000_000).default(0),
  coverage: z.enum(["auto", "local", "regional", "provincial", "national"]).default("auto"),
  radiusKm: z.coerce.number().min(0).max(1000).default(0),
  website: z.enum(["any", "has", "none"]).default("any"),
  hasPhone: z.boolean().default(false),
  minRating: z.coerce.number().min(0).max(5).default(0),
  smallOnly: z.boolean().default(true),
  includeExisting: z.boolean().default(false),
  repeatSearches: z.boolean().default(false),
  excludeNames: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
  excludeDomains: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  requireEmail: z.boolean().default(false),
  minOpportunity: z.coerce.number().int().min(0).max(100).default(0),
  minWebsiteScore: z.coerce.number().int().min(0).max(100).default(0),
  maxWebsiteScore: z.coerce.number().int().min(0).max(100).default(100),
  steps: z.object({ contacts: z.boolean().default(true), audit: z.boolean().default(true), prompts: z.boolean().default(true), drafts: z.boolean().default(true) }).default({ contacts: true, audit: true, prompts: true, drafts: true }),
  maxAiEmails: z.coerce.number().int().min(0).max(20000).default(50),
  concurrency: z.coerce.number().int().min(1).max(5).default(2),
  templateId: z.string().nullable().optional(),
});
export type AutoProspectInputT = z.infer<typeof AutoProspectInput>;

const SLICE_MS = 240_000;
const ACTIVE = ["QUEUED", "RUNNING"];

/** Requests the budget allows (Google is the only paid provider). */
export function requestCap(i: Pick<AutoProspectInputT, "maxRequests" | "budgetCents" | "providers">) {
  if (!i.budgetCents || !i.providers.includes("google_places")) return i.maxRequests;
  return Math.max(1, Math.min(i.maxRequests, Math.floor(i.budgetCents / PROVIDERS.google_places.costPerRequestCents)));
}

export function estimateCost(i: Pick<AutoProspectInputT, "maxRequests" | "budgetCents" | "providers">) {
  const req = requestCap(i);
  const cents = i.providers.reduce((s, p) => s + PROVIDERS[p].costPerRequestCents * req, 0);
  return { requests: req, cents: Math.round(cents) };
}

export async function createAutoProspect(workspaceId: string, userId: string, input: AutoProspectInputT) {
  const { automation } = await getSettings(workspaceId);
  if (automation.automationPaused) throw new AppError("VALIDATION", "All automation is paused. Resume it in Settings → Automation Control Center first.");
  if (input.templateId && !(await db.emailTemplate.findFirst({ where: { id: input.templateId, workspaceId, kind: "OUTREACH" }, select: { id: true } }))) throw new AppError("VALIDATION", "That email template no longer exists.");
  const campaign = await db.campaign.create({
    data: {
      workspaceId, name: input.name, status: "ACTIVE", templateId: input.templateId ?? null,
      description: `AutoProspect: ${input.categories.join(", ")} in ${input.locations.join("; ")}`,
      searchSettings: { location: input.locations.join("; "), category: input.categories.join(", "), autoprospect: true },
    },
  });
  const run = await db.automationRun.create({ data: { workspaceId, campaignId: campaign.id, name: input.name, config: input as Prisma.InputJsonValue, createdById: userId, message: "Starting…" } });
  try {
    const disc = await createDiscoveryRun(workspaceId, userId, {
      locations: input.locations,
      queries: Array.from(new Set([...input.categories, ...input.keywords])),
      providers: input.providers,
      target: input.target,
      maxRequests: requestCap(input),
      campaignId: campaign.id,
      options: {
        coverage: input.coverage, website: input.website, hasPhone: input.hasPhone, minRating: input.minRating, openStatus: "operational", smallOnly: input.smallOnly,
        includeExisting: input.includeExisting, repeatSearches: input.repeatSearches, excludeNames: input.excludeNames, excludeDomains: input.excludeDomains, autoAudit: false,
        findEmails: false, radiusKm: input.radiusKm, circles: [],
      },
    }, { automationRunId: run.id });
    await db.automationRun.update({ where: { id: run.id }, data: { discoveryRunId: disc.id } });
  } catch (e) {
    await db.automationRun.update({ where: { id: run.id }, data: { status: "FAILED", error: describeError(e), finishedAt: new Date() } });
    throw e;
  }
  await logActivity({ workspaceId, userId, action: "autoprospect.started", summary: `AutoProspect “${input.name}” started: ${input.categories.join(", ")} in ${input.locations.join("; ")} (target ${input.target})` });
  await enqueueSlice(run);
  return run;
}

async function enqueueSlice(run: Pick<AutomationRun, "id" | "workspaceId" | "createdById" | "name">) {
  const existing = await db.job.findFirst({ where: { workspaceId: run.workspaceId, type: "AUTOPROSPECT", status: { in: ["QUEUED", "RUNNING"] }, payload: { path: ["runId"], equals: run.id } }, select: { id: true } });
  if (existing) return existing;
  const { enqueueJob } = await import("../jobs/queue");
  return enqueueJob({ workspaceId: run.workspaceId, type: "AUTOPROSPECT", label: `AutoProspect: ${run.name}`, payload: { runId: run.id }, createdById: run.createdById, maxAttempts: 3 });
}

// ───────────── Per-business pipeline ─────────────

function autoSendAllowed(a: AutomationSettings, c: ComplianceSettings, e: { eligibility: string; basis: string }) {
  if (a.outreachMode !== "AUTOMATED_ELIGIBLE" || !a.outreachSendingEnabled || a.automationPaused) return false;
  if (e.eligibility !== "ELIGIBLE") return false;
  const basisOk = e.basis === "EXPRESS" || e.basis === "IMPLIED_EXISTING_RELATIONSHIP" || (e.basis === "IMPLIED_CONSPICUOUS_PUBLICATION" && a.autoSendImpliedConsent);
  // CASL: identification and a working unsubscribe mechanism must be in every message.
  return basisOk && Boolean(c.physicalAddress.trim()) && c.includeUnsubscribeFooter;
}

async function processItem(run: AutomationRun, item: AutomationItem, cfg: AutoProspectInputT, s: { automation: AutomationSettings; compliance: ComplianceSettings }, toSend: string[]) {
  const ws = run.workspaceId;
  const userId = run.createdById;
  const save = (data: Prisma.AutomationItemUpdateInput) => db.automationItem.update({ where: { id: item.id }, data });
  try {
    await save({ attempts: { increment: 1 } });
    let b = await db.business.findFirst({ where: { id: item.businessId, workspaceId: ws } });
    if (!b) return void (await save({ status: "SKIPPED", skipReason: "Lead was deleted" }));
    if (b.doNotContact) return void (await save({ status: "SKIPPED", skipReason: "Marked Do Not Contact" }));

    if (cfg.steps.contacts && s.automation.contactDiscoveryEnabled && !item.contactsAt) {
      const r = await discoverContacts(ws, b.id, { userId });
      await save({ contactsAt: new Date(), emailsFound: r.total });
    }
    if (cfg.steps.audit && s.automation.websiteAnalysisEnabled && !item.auditAt) {
      await runWebsiteAudit(ws, b.id, { userId });
      await save({ auditAt: new Date() });
    }
    b = (await db.business.findUnique({ where: { id: b.id } }))!;

    // Qualification (data gathered so far is kept either way).
    const contacts = await db.contact.findMany({ where: { businessId: b.id, email: { not: null } }, select: { eligibility: true } });
    if (cfg.requireEmail && !contacts.some((c) => c.eligibility !== "INELIGIBLE")) return void (await save({ status: "SKIPPED", skipReason: "No usable public business email found", eligibility: contacts.length ? "INELIGIBLE" : "NO_EMAIL" }));
    if (s.automation.opportunityScoringEnabled && cfg.minOpportunity > 0 && (b.opportunityScore ?? 0) < cfg.minOpportunity) return void (await save({ status: "SKIPPED", skipReason: `Opportunity score ${b.opportunityScore ?? "unknown"} is below ${cfg.minOpportunity}` }));
    if (b.websiteScore != null && (b.websiteScore < cfg.minWebsiteScore || b.websiteScore > cfg.maxWebsiteScore)) return void (await save({ status: "SKIPPED", skipReason: `Website score ${b.websiteScore} is outside ${cfg.minWebsiteScore}–${cfg.maxWebsiteScore}` }));

    if (cfg.steps.prompts && s.automation.promptGenerationEnabled && !item.promptAt) {
      if (!(await db.generatedPrompt.findFirst({ where: { businessId: b.id }, select: { id: true } }))) await generatePrompt(ws, b.id, userId);
      await save({ promptAt: new Date() });
    }

    let draftId = item.draftMessageId;
    let skipReason: string | null = null;
    if (cfg.steps.drafts && s.automation.emailGenerationEnabled && !item.draftAt) {
      const contacted = await db.emailMessage.findFirst({ where: { businessId: b.id, direction: "OUTBOUND", kind: "OUTREACH", status: { in: ["SENT", "QUEUED"] } }, select: { id: true } });
      const recipient = b.email ? await recipientEligibility(ws, b.id, b.email) : null;
      if (contacted) skipReason = "Already contacted — no new outreach drafted";
      else if (!b.email) skipReason = "No email address — call script available on the lead";
      else if (recipient?.eligibility === "INELIGIBLE") skipReason = `No draft: ${recipient.reason}`;
      else {
        const used = (await db.automationRun.findUnique({ where: { id: run.id }, select: { aiRequests: true } }))?.aiRequests ?? 0;
        const r = await generateOutreachDraft(ws, b.id, userId, { campaignId: run.campaignId, templateId: cfg.templateId ?? null, useAi: used < cfg.maxAiEmails });
        draftId = r.draft.id;
        if (r.draft.aiGenerated) await db.automationRun.update({ where: { id: run.id }, data: { aiRequests: { increment: 1 } } });
        await save({ draftAt: new Date(), draftMessageId: r.draft.id });
      }
    }

    const e = b.email ? await recipientEligibility(ws, b.id, b.email) : null;
    if (draftId && e && autoSendAllowed(s.automation, s.compliance, e)) {
      const draft = await db.emailMessage.findUnique({ where: { id: draftId } });
      if (draft?.status === "DRAFT" && !/\{\{\s*[a-z_]+\s*\}\}/.test(draft.subject + draft.bodyText)) {
        await db.outreachApproval.upsert({ where: { messageId: draft.id }, create: { workspaceId: ws, messageId: draft.id, businessId: b.id, email: draft.toAddress, decision: "AUTO_SENT", eligibility: e as Prisma.InputJsonValue }, update: {} });
        toSend.push(draft.id);
      }
    }
    await save({ status: "DONE", eligibility: e?.eligibility ?? "NO_EMAIL", skipReason, error: null });
  } catch (err) {
    const attempts = item.attempts + 1;
    await save({ status: attempts >= 3 ? "FAILED" : "PENDING", error: describeError(err).slice(0, 500) });
  }
}

// ───────────── Slices ─────────────

async function pauseRun(runId: string, message: string) {
  const run = await db.automationRun.update({ where: { id: runId }, data: { status: "PAUSED", message } });
  if (run.discoveryRunId) await db.discoveryRun.updateMany({ where: { id: run.discoveryRunId, status: { in: ACTIVE } }, data: { status: "PAUSED", message } });
}

/** One time-boxed slice: some discovery, then the per-business pipeline. Re-enqueues itself until done. */
export async function runAutoProspectSlice(runId: string, sliceMs = SLICE_MS) {
  let run = await db.automationRun.findUnique({ where: { id: runId } });
  if (!run || !ACTIVE.includes(run.status)) return { state: run?.status ?? "MISSING" };
  const settings = await getSettings(run.workspaceId);
  if (settings.automation.automationPaused) {
    await pauseRun(runId, "Paused: all automation is paused in the Automation Control Center.");
    return { state: "PAUSED" };
  }
  run = await db.automationRun.update({ where: { id: runId }, data: { status: "RUNNING" } });
  const cfg = AutoProspectInput.parse(run.config);
  const deadline = Date.now() + sliceMs;

  // Phase 1 — discovery (runs alongside processing so every stage moves).
  const disc = run.discoveryRunId ? await db.discoveryRun.findUnique({ where: { id: run.discoveryRunId } }) : null;
  if (disc && ACTIVE.includes(disc.status) && settings.automation.discoveryEnabled) {
    await processDiscoveryRun(disc.id, Math.min(deadline, Date.now() + Math.floor(sliceMs / 3)));
  }

  // Phases 2–6 — contacts, analysis, scoring, prompts, drafts, queue.
  const toSend: string[] = [];
  for (;;) {
    if (Date.now() > deadline) break;
    const fresh = await db.automationRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!fresh || !ACTIVE.includes(fresh.status)) break;
    const batch = await db.automationItem.findMany({ where: { runId, status: "PENDING" }, orderBy: { id: "asc" }, take: cfg.concurrency });
    if (!batch.length) {
      const d = run.discoveryRunId ? await db.discoveryRun.findUnique({ where: { id: run.discoveryRunId }, select: { status: true } }) : null;
      if (d && ACTIVE.includes(d.status) && Date.now() < deadline) {
        await processDiscoveryRun(run.discoveryRunId!, Math.min(deadline, Date.now() + 60_000));
        continue;
      }
      break;
    }
    await Promise.all(batch.map((item) => processItem(run!, item, cfg, settings, toSend)));
  }
  if (toSend.length) {
    const { enqueueJob } = await import("../jobs/queue");
    await enqueueJob({ workspaceId: run.workspaceId, type: "BULK_ACTION", label: `Send ${toSend.length} eligible outreach email${toSend.length === 1 ? "" : "s"} (AutoProspect)`, payload: { messageIds: toSend }, createdById: run.createdById });
  }

  // Decide what happens next.
  run = (await db.automationRun.findUnique({ where: { id: runId } }))!;
  const counters = await computeCounters(run);
  await db.automationRun.update({ where: { id: runId }, data: { counters: counters as Prisma.InputJsonValue, checkpointAt: new Date(), placesRequests: counters.requests, costCents: counters.costCents } });
  if (!ACTIVE.includes(run.status)) return { state: run.status };
  const d = run.discoveryRunId ? await db.discoveryRun.findUnique({ where: { id: run.discoveryRunId } }) : null;
  const discoveryActive = Boolean(d && ACTIVE.includes(d.status));
  const pending = await db.automationItem.count({ where: { runId, status: "PENDING" } });
  if (!discoveryActive && pending === 0) {
    if (d?.status === "PAUSED") {
      await db.automationRun.update({ where: { id: runId }, data: { status: "PAUSED", phase: "DISCOVERY", message: `Every business found so far is processed. Discovery is paused: ${d.message ?? ""}` } });
      return { state: "PAUSED" };
    }
    const msg = `Done: ${counters.discovered} businesses, ${counters.emailsDiscovered} public emails, ${counters.websitesAnalyzed} websites analysed, ${counters.draftsCreated} outreach drafts (${counters.awaitingApproval} awaiting approval).`;
    await db.automationRun.update({ where: { id: runId }, data: { status: "COMPLETED", phase: "DONE", message: msg, finishedAt: new Date() } });
    await notify({ workspaceId: run.workspaceId, type: "JOB_COMPLETED", title: `AutoProspect “${run.name}” finished`, body: msg, link: `/autoprospect/${run.id}` });
    await logActivity({ workspaceId: run.workspaceId, userId: run.createdById, action: "autoprospect.completed", summary: `AutoProspect “${run.name}”: ${msg}` });
    return { state: "COMPLETED" };
  }
  await db.automationRun.update({ where: { id: runId }, data: { phase: discoveryActive ? "DISCOVERY" : "PROCESSING", message: discoveryActive ? (d?.message ?? "Discovering businesses…") : `Researching businesses (${pending} left)…` } });
  await enqueueSlice(run);
  return { state: "YIELD" };
}

// ───────────── Live counters ─────────────

export async function computeCounters(run: AutomationRun) {
  const d = run.discoveryRunId ? await db.discoveryRun.findUnique({ where: { id: run.discoveryRunId } }) : null;
  const items = await db.automationItem.findMany({ where: { runId: run.id }, select: { businessId: true, status: true, auditAt: true, promptAt: true, draftAt: true, draftMessageId: true, eligibility: true } });
  const ids = items.map((i) => i.businessId);
  const draftIds = items.map((i) => i.draftMessageId).filter(Boolean) as string[];
  const audited = items.filter((i) => i.auditAt).map((i) => i.businessId);
  const [websites, emails, validated, analysed, awaiting, sent, failedSends] = await Promise.all([
    db.business.count({ where: { id: { in: ids }, website: { not: null } } }),
    db.contact.count({ where: { businessId: { in: ids }, email: { not: null }, classification: { in: ["VERIFIED_PUBLIC", "PUBLIC_DIRECTORY", "LICENSED_PROVIDER"] } } }),
    db.contact.count({ where: { businessId: { in: ids }, email: { not: null }, verification: "VALID" } }),
    db.business.count({ where: { id: { in: audited }, website: { not: null } } }),
    db.emailMessage.count({ where: { id: { in: draftIds }, status: "DRAFT" } }),
    db.emailMessage.count({ where: { businessId: { in: ids }, kind: "OUTREACH", status: "SENT", ...(run.campaignId ? { campaignId: run.campaignId } : {}) } }),
    db.emailMessage.count({ where: { businessId: { in: ids }, kind: "OUTREACH", status: { in: ["FAILED", "BOUNCED"] } } }),
  ]);
  const by = (s: string) => items.filter((i) => i.status === s).length;
  const perProvider = d ? await db.discoveryZone.groupBy({ by: ["provider"], where: { runId: d.id }, _sum: { pages: true } }) : [];
  return {
    discovered: d?.found ?? ids.length,
    duplicates: d?.duplicates ?? 0,
    filtered: d?.filtered ?? 0,
    requests: d?.requests ?? 0,
    costCents: Math.round(perProvider.reduce((s, p) => s + (p._sum.pages ?? 0) * (PROVIDERS[p.provider as ProviderId]?.costPerRequestCents ?? 0), 0)),
    websitesIdentified: websites,
    emailsDiscovered: emails,
    emailsValidated: validated,
    websitesAnalyzed: analysed,
    promptsGenerated: items.filter((i) => i.promptAt).length,
    draftsCreated: items.filter((i) => i.draftAt).length,
    eligible: items.filter((i) => i.eligibility === "ELIGIBLE").length,
    needsReview: items.filter((i) => i.eligibility === "NEEDS_REVIEW").length,
    awaitingApproval: awaiting,
    sent,
    failedSends,
    processed: by("DONE") + by("SKIPPED") + by("FAILED"),
    pending: by("PENDING"),
    done: by("DONE"),
    skipped: by("SKIPPED"),
    failed: by("FAILED"),
    aiEmails: run.aiRequests,
  };
}
export type AutoProspectCounters = Awaited<ReturnType<typeof computeCounters>>;

export async function getAutoProspect(workspaceId: string, id: string) {
  const run = await db.automationRun.findFirst({ where: { id, workspaceId } });
  if (!run) throw new AppError("NOT_FOUND", "AutoProspect run not found.");
  const [counters, zones, disc, recent, failed, zoneErrors] = await Promise.all([
    computeCounters(run),
    run.discoveryRunId ? zoneSummary(run.discoveryRunId) : null,
    run.discoveryRunId ? db.discoveryRun.findUnique({ where: { id: run.discoveryRunId }, select: { status: true, message: true, target: true, maxRequests: true, locations: true, queries: true, providers: true } }) : null,
    db.automationItem.findMany({ where: { runId: id }, orderBy: { updatedAt: "desc" }, take: 40 }),
    db.automationItem.findMany({ where: { runId: id, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 50 }),
    run.discoveryRunId ? db.discoveryZone.findMany({ where: { runId: run.discoveryRunId, status: "FAILED" }, select: { id: true, label: true, query: true, error: true }, take: 30 }) : [],
  ]);
  const bizIds = Array.from(new Set([...recent, ...failed].map((i) => i.businessId)));
  const businesses = await db.business.findMany({ where: { id: { in: bizIds } }, select: { id: true, name: true, city: true, email: true, website: true, opportunityScore: true, websiteClass: true, status: true } });
  const bmap = new Map(businesses.map((b) => [b.id, b]));
  const withBiz = (i: AutomationItem) => ({ ...i, business: bmap.get(i.businessId) ?? null });
  return { run, counters, zones, discovery: disc, recent: recent.map(withBiz), failed: failed.map(withBiz), zoneErrors, estimate: estimateCost(AutoProspectInput.parse(run.config)) };
}

export async function controlAutoProspect(workspaceId: string, id: string, action: "pause" | "resume" | "cancel" | "retry_failed" | "continue", extra: { addTarget?: number; addRequests?: number } = {}) {
  const run = await db.automationRun.findFirst({ where: { id, workspaceId } });
  if (!run) throw new AppError("NOT_FOUND", "AutoProspect run not found.");
  if (action === "pause") {
    if (!ACTIVE.includes(run.status)) throw new AppError("CONFLICT", `This run is ${run.status.toLowerCase()}.`);
    await pauseRun(id, "Paused by a team member. Everything finished so far is kept — press Resume to continue.");
    return;
  }
  if (action === "cancel") {
    await db.automationRun.update({ where: { id }, data: { status: "CANCELLED", message: "Cancelled. Businesses, contacts, audits and drafts already created are kept.", finishedAt: new Date() } });
    if (run.discoveryRunId) await db.discoveryRun.updateMany({ where: { id: run.discoveryRunId, status: { notIn: ["COMPLETED", "FAILED"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
    return;
  }
  const { automation } = await getSettings(workspaceId);
  if (automation.automationPaused) throw new AppError("VALIDATION", "All automation is paused. Resume it in the Automation Control Center first.");
  if (action === "retry_failed") {
    await db.automationItem.updateMany({ where: { runId: id, status: "FAILED" }, data: { status: "PENDING", attempts: 0, error: null } });
    if (run.discoveryRunId) await db.discoveryZone.updateMany({ where: { runId: run.discoveryRunId, status: "FAILED" }, data: { status: "PENDING", attempts: 0 } });
  }
  if (run.discoveryRunId) {
    const d = await db.discoveryRun.findUnique({ where: { id: run.discoveryRunId } });
    if (d) {
      const data: Prisma.DiscoveryRunUpdateInput = {};
      if (action === "continue") {
        if (extra.addTarget) data.target = d.target + extra.addTarget;
        if (extra.addRequests) data.maxRequests = d.maxRequests + extra.addRequests;
      }
      const reopen = d.status === "PAUSED" || (action === "continue" && d.status === "COMPLETED") || (action === "retry_failed" && d.status === "COMPLETED");
      await db.discoveryRun.update({ where: { id: d.id }, data: { ...data, ...(reopen ? { status: "QUEUED", finishedAt: null } : {}) } });
    }
  }
  if (run.status === "CANCELLED" && action !== "continue") throw new AppError("CONFLICT", "This run was cancelled. Use Continue to restart it.");
  const resumed = await db.automationRun.update({ where: { id }, data: { status: "QUEUED", finishedAt: null, message: "Continuing…" } });
  await enqueueSlice(resumed);
}

export async function listAutoProspects(workspaceId: string, take = 30) {
  return db.automationRun.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take });
}

/** Global controls from the Automation Control Center. */
export async function pauseAllAutomation(workspaceId: string, userId: string, paused: boolean) {
  await db.automationSettings.update({ where: { workspaceId }, data: { automationPaused: paused } });
  if (paused) {
    const active = await db.automationRun.findMany({ where: { workspaceId, status: { in: ACTIVE } }, select: { id: true } });
    for (const r of active) await pauseRun(r.id, "Paused: all automation is paused in the Automation Control Center.");
    await db.discoveryRun.updateMany({ where: { workspaceId, status: { in: ACTIVE } }, data: { status: "PAUSED", message: "Paused: all automation is paused in the Automation Control Center." } });
  } else {
    // Runs that were stopped only by the global pause carry on.
    const held = await db.automationRun.findMany({ where: { workspaceId, status: "PAUSED", message: { startsWith: "Paused: all automation" } }, select: { id: true } });
    for (const r of held) await controlAutoProspect(workspaceId, r.id, "resume");
    const runs = await db.discoveryRun.findMany({ where: { workspaceId, status: "PAUSED", automationRunId: null, message: { startsWith: "Paused: all automation" } } });
    const { enqueueDiscoveryRun } = await import("../discovery/run");
    for (const r of runs) {
      await db.discoveryRun.update({ where: { id: r.id }, data: { status: "QUEUED" } });
      await enqueueDiscoveryRun(r);
    }
  }
  await logActivity({ workspaceId, userId, action: paused ? "automation.paused_all" : "automation.resumed_all", summary: paused ? "All automation paused" : "All automation resumed" });
}
