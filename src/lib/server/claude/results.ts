import "../guard";
import * as z from "zod";
import type { Business, ClaudeConnection, ClaudeTask, Prisma } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError, fetchWithTimeout } from "../errors";
import { notify } from "../activity";
import { findDuplicate, upsertBusiness, normalizeWebsite } from "../leads";
import { leadAllowance, limitReachedMessage } from "../billing";
import { enqueueJob } from "../jobs/queue";
import { getSettings } from "../workspace";
import { politeFetch } from "../audit/fetcher";
import { resolveAreaWithOsm } from "../discovery/geo";
import { smallBusinessCheck } from "../discovery/small-business";
import { NO_SOLICITATION, emailRole, evaluateContact } from "../contacts/discover";
import { scanCommitments } from "../email/safety";
import { addEvent, bumpStats, FindLeadsParams } from "./tasks";
import { appUrl } from "./connections";

/**
 * What Claude sends back. Nothing Claude says is trusted as-is: businesses are deduplicated and
 * must cite a source, emails are only saved when WebScout finds them on the cited page, facts are
 * marked verified only when the value appears on the source page, and emails are saved as drafts
 * that a person must approve before anything is sent.
 */
const SOURCE_TYPES = ["OFFICIAL_WEBSITE", "MAPS", "DIRECTORY", "SOCIAL", "NEWS", "GOVERNMENT", "OTHER"] as const;
const sourceType = z.string().max(40).optional().transform((v) => {
  const t = (v ?? "OTHER").toUpperCase().replace(/[^A-Z]+/g, "_");
  return (SOURCE_TYPES as readonly string[]).includes(t) ? t : "OTHER";
});
const httpUrl = z.string().trim().max(2000).url().refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL");

export const BusinessItem = z.object({
  name: z.string().trim().min(2).max(200),
  category: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  postal_code: z.string().trim().max(20).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(500).optional(),
  google_maps_url: httpUrl.optional(),
  rating: z.number().min(0).max(5).optional(),
  review_count: z.number().int().min(0).max(10_000_000).optional(),
  services: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  photo_urls: z.array(httpUrl).max(5).optional(),
  sources: z.array(z.object({ url: httpUrl, type: sourceType })).min(1, "At least one source URL is required").max(10),
});
export type BusinessItemT = z.infer<typeof BusinessItem>;

export const ContactItem = z.object({
  business_id: z.string().min(5).max(40),
  email: z.string().trim().toLowerCase().email().max(200),
  source_url: httpUrl,
  contact_name: z.string().trim().max(120).optional(),
  role: z.string().trim().max(120).optional(),
});

export const FactItem = z.object({
  field: z.string().trim().min(2).max(60),
  value: z.string().trim().min(1).max(1500),
  kind: z.enum(["fact", "estimate"]).default("fact"),
  source_url: httpUrl.optional(),
  source_type: sourceType,
  confidence: z.number().int().min(0).max(100).optional(),
});

type Ctx = { conn: ClaudeConnection; task: ClaudeTask | null };
const actor = (c: Ctx) => c.task?.createdById ?? c.conn.createdById ?? null;
const where = (b: { city?: string | null; region?: string | null }) => [b.city, b.region].filter(Boolean).join(", ");

/** The street address without unit / floor / suite details, which geocoders can't match. */
export function geocodableAddress(b: { address?: string | null; city?: string | null; region?: string | null; postal_code?: string | null; country?: string | null }) {
  const street = (b.address ?? "")
    .replace(/,?\s*(?:unit|suite|ste|apt|room|rm|#)\s*[\w-]+/gi, "")
    .replace(/,?\s*\d+(?:st|nd|rd|th)\s*(?:fl(?:oor)?|level)\.?/gi, "")
    .replace(/,?\s*(?:fl(?:oor)?|level)\s*\d+/gi, "")
    .replace(/\.(?=\s|,|$)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim()
    .replace(/,$/, "");
  return [street, b.city, b.region, b.postal_code, b.country].filter(Boolean).join(", ");
}

/** Coordinates for a street address: OpenStreetMap Nominatim, then Photon (also OSM data) if that fails. */
async function geocode(b: BusinessItemT) {
  if (!b.address) return null;
  const q = geocodableAddress(b);
  if (q.length < 6) return null;
  try {
    return (await resolveAreaWithOsm(q)).center;
  } catch {
    /* fall through to Photon */
  }
  try {
    const res = await fetchWithTimeout(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`, { service: "Photon geocoder", timeoutMs: 15000, headers: { "User-Agent": "WebScoutAI/1.0 (business discovery for a web agency)" } });
    if (!res.ok) return null;
    const d = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number] } }[] };
    const c = d.features?.[0]?.geometry?.coordinates;
    return c ? { lat: c[1], lng: c[0] } : null;
  } catch {
    return null;
  }
}

async function businessInWorkspace(workspaceId: string, id: string) {
  const b = await db.business.findFirst({ where: { id, workspaceId } });
  if (!b) throw new AppError("NOT_FOUND", `No business ${id} in this workspace (use search_leads to find ids).`);
  return b;
}

// ───────────── Businesses ─────────────

export async function submitBusinesses(c: Ctx, items: BusinessItemT[]) {
  const ws = c.conn.workspaceId;
  const params = c.task?.type === "FIND_LEADS" ? FindLeadsParams.safeParse(c.task.parameters).data ?? null : null;
  const allowance = await leadAllowance(ws);
  let remaining = allowance.remaining;
  const added: { business_id: string; name: string; city: string | null; geocoded: boolean }[] = [];
  const duplicates: { business_id: string; name: string; reason: string }[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const toAudit: string[] = [];

  for (const b of items) {
    const reject = async (reason: string) => {
      rejected.push({ name: b.name, reason });
      await addEvent({ workspaceId: ws, id: c.task?.id }, "BUSINESS_REJECTED", `Skipped ${b.name}: ${reason}`);
    };
    if (!b.address && !b.city) {
      await reject("needs at least a city or street address");
      continue;
    }
    const site = normalizeWebsite(b.website);
    if (params?.websiteFilter === "none" && site?.domain && !/facebook|instagram|yelp|google|linktr|tiktok|twitter|x\.com|yellowpages|tripadvisor/i.test(site.domain)) {
      await reject(`has its own website (${site.domain}); this task wants businesses without one`);
      continue;
    }
    if (params?.smallOnly !== false) {
      const small = smallBusinessCheck({ name: b.name, types: b.category ? [b.category.toLowerCase()] : [], reviewCount: b.review_count ?? null });
      if (!small.ok) {
        await reject(small.reason);
        continue;
      }
    }
    let lat = b.latitude ?? null;
    let lng = b.longitude ?? null;
    let geocoded = false;
    if ((lat == null || lng == null) && b.address) {
      const p = await geocode(b);
      if (p) {
        lat = p.lat;
        lng = p.lng;
        geocoded = true;
      }
    }
    const input = {
      name: b.name, category: b.category ?? null, address: b.address ?? null, city: b.city ?? null, region: b.region ?? null, country: b.country ?? null,
      postalCode: b.postal_code ?? null, latitude: lat, longitude: lng, phone: b.phone ?? null, website: b.website ?? null, rating: b.rating ?? null,
      reviewCount: b.review_count ?? null, googleMapsUrl: b.google_maps_url ?? null, source: "CLAUDE_RESEARCH" as const,
    };
    // Duplicates don't use the allowance; only check it for genuinely new businesses.
    const dup = await findDuplicate(ws, input);
    if (!dup && remaining <= 0) {
      await reject(limitReachedMessage(allowance));
      continue;
    }
    const r = await upsertBusiness(ws, input, actor(c));
    if (r.created) {
      remaining -= 1;
      added.push({ business_id: r.business.id, name: r.business.name, city: r.business.city, geocoded });
      if (r.business.website) toAudit.push(r.business.id);
      await addEvent({ workspaceId: ws, id: c.task?.id }, "BUSINESS_CREATED", `Found ${r.business.name}${where(r.business) ? ` (${where(r.business)})` : ""}`, { businessId: r.business.id, data: { lat, lng } });
    } else {
      duplicates.push({ business_id: r.business.id, name: r.business.name, reason: r.duplicateReason ?? "already in the CRM" });
      await addEvent({ workspaceId: ws, id: c.task?.id }, "BUSINESS_DUPLICATE", `Already in your CRM: ${r.business.name} (${r.duplicateReason})`, { businessId: r.business.id });
    }
    await saveSourcedFacts(c, r.business, b);
  }

  if (toAudit.length) {
    await enqueueJob({ workspaceId: ws, type: "WEBSITE_AUDIT", label: `Audit ${toAudit.length} website(s) found by Claude`, payload: { businessIds: toAudit }, createdById: actor(c) });
    if (params?.findContacts !== false) await enqueueJob({ workspaceId: ws, type: "CONTACT_DISCOVERY", label: `Find public emails for ${toAudit.length} business(es) found by Claude`, payload: { businessIds: toAudit }, createdById: actor(c) });
    await addEvent({ workspaceId: ws, id: c.task?.id }, "AUDITS_QUEUED", `Website audit${params?.findContacts !== false ? " and email check" : ""} queued for ${toAudit.length} business${toAudit.length === 1 ? "" : "es"}`);
  }
  let progress: { found_so_far: number; target: number } | null = null;
  if (c.task) {
    const s = await bumpStats(c.task.id, { submitted: items.length, created: added.length, duplicates: duplicates.length, rejected: rejected.length });
    const target = params?.count ?? 0;
    if (target) {
      progress = { found_so_far: s.created ?? 0, target };
      await db.claudeTask.update({ where: { id: c.task.id }, data: { progress: Math.min(95, Math.round(((s.created ?? 0) / target) * 100)), progressMessage: (s.created ?? 0) >= target ? `${s.created} businesses found — target of ${target} reached` : `${s.created ?? 0} of ${target} businesses found` } });
    }
  }
  return {
    added, duplicates, rejected,
    leads_left_this_month: remaining === Number.POSITIVE_INFINITY ? "unlimited" : Math.max(0, remaining),
    ...(progress ? { task_progress: progress } : {}),
    note: toAudit.length ? "WebScout is auditing the new websites and checking for public emails in the background." : undefined,
  };
}

/** Sources, description, services and photos from a submission become evidence on the lead. */
async function saveSourcedFacts(c: Ctx, business: Business, b: BusinessItemT) {
  const rows: Prisma.BusinessEvidenceCreateManyInput[] = [];
  const base = { workspaceId: business.workspaceId, businessId: business.id, taskId: c.task?.id ?? null, createdBy: "CLAUDE" };
  const known = new Set((await db.businessEvidence.findMany({ where: { businessId: business.id }, select: { field: true, value: true } })).map((e) => `${e.field}|${e.value}`));
  const add = (r: Omit<Prisma.BusinessEvidenceCreateManyInput, "workspaceId" | "businessId">) => {
    if (known.has(`${r.field}|${r.value}`)) return;
    known.add(`${r.field}|${r.value}`);
    rows.push({ ...base, ...r });
  };
  for (const s of b.sources) add({ field: "listing", value: s.url, sourceUrl: s.url, sourceType: s.type, kind: "FACT" });
  const first = b.sources[0]!;
  if (b.description) add({ field: "summary", value: b.description, sourceUrl: first.url, sourceType: first.type, kind: "FACT" });
  if (b.services?.length) add({ field: "services", value: b.services.join(", "), sourceUrl: first.url, sourceType: first.type, kind: "FACT" });
  for (const p of b.photo_urls ?? []) add({ field: "photo", value: p, sourceUrl: first.url, sourceType: first.type, kind: "FACT" });
  if (rows.length) await db.businessEvidence.createMany({ data: rows });
  if (!business.imageUrl && b.photo_urls?.[0]) await db.business.update({ where: { id: business.id }, data: { imageUrl: b.photo_urls[0] } });
}

// ───────────── Contacts ─────────────

const decode = (s: string) => s.replace(/&#64;|&#x40;|&commat;/gi, "@").replace(/&#46;|&#x2e;|&period;/gi, ".").replace(/&amp;/g, "&");
const pageText = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

async function fetchPage(url: string) {
  const r = await politeFetch(url, { timeoutMs: 15000 });
  if (r.status >= 400) throw new AppError("UPSTREAM_ERROR", `the page returned HTTP ${r.status}`);
  return { html: decode(r.body), text: pageText(r.body), finalUrl: r.finalUrl };
}

export async function submitContacts(c: Ctx, items: z.infer<typeof ContactItem>[]) {
  const ws = c.conn.workspaceId;
  const { automation } = await getSettings(ws);
  const verified: { business_id: string; email: string; eligibility: string; reason: string }[] = [];
  const rejected: { business_id: string; email: string; reason: string }[] = [];
  const pages = new Map<string, Awaited<ReturnType<typeof fetchPage>> | Error>();
  for (const it of items.slice(0, 25)) {
    const business = await businessInWorkspace(ws, it.business_id);
    const reject = async (reason: string) => {
      rejected.push({ business_id: business.id, email: it.email, reason });
      await addEvent({ workspaceId: ws, id: c.task?.id }, "CONTACT_REJECTED", `Not saved: ${it.email} for ${business.name} — ${reason}`, { businessId: business.id });
    };
    let page = pages.get(it.source_url);
    if (!page) {
      page = await fetchPage(it.source_url).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
      pages.set(it.source_url, page);
    }
    if (page instanceof Error) {
      await reject(`WebScout couldn't open the source page to confirm it (${describeError(page)})`);
      continue;
    }
    const hay = `${page.html}\n${page.text}`.toLowerCase();
    const at = hay.indexOf(it.email);
    if (at < 0) {
      await reject("the address doesn't appear on that page — only send emails exactly as published");
      continue;
    }
    const host = new URL(page.finalUrl).hostname.replace(/^www\./, "");
    const own = Boolean(business.websiteDomain && (host === business.websiteDomain || host.endsWith(`.${business.websiteDomain}`)));
    const classification = own ? "VERIFIED_PUBLIC" : "PUBLIC_DIRECTORY";
    const ti = page.text.toLowerCase().indexOf(it.email);
    const snippet = ti >= 0 ? page.text.slice(Math.max(0, ti - 100), ti + it.email.length + 100).trim() : it.email;
    const existing = await db.contact.findFirst({ where: { businessId: business.id, email: it.email } });
    const contact = existing
      ? await db.contact.update({ where: { id: existing.id }, data: existing.classification === "VERIFIED_PUBLIC" || existing.classification === "MANUAL" ? {} : { classification, sourceUrl: page.finalUrl, sourceSnippet: snippet.slice(0, 300), source: "Found by Claude research (checked on the page)" } })
      : await db.contact.create({ data: { workspaceId: ws, businessId: business.id, email: it.email, name: it.contact_name ?? null, role: it.role ?? emailRole(it.email).role, source: "Found by Claude research (checked on the page)", classification, sourceUrl: page.finalUrl, sourceSnippet: snippet.slice(0, 300) } });
    const evaluated = await evaluateContact(contact, business, { checksEnabled: automation.eligibilityChecksEnabled, noSolicitation: NO_SOLICITATION.test(page.text), snippet });
    if (!business.email && evaluated.eligibility !== "INELIGIBLE") {
      await db.business.update({ where: { id: business.id }, data: { email: it.email, emailSource: own ? `Publicly listed on the business website (${page.finalUrl})` : `Public listing (${page.finalUrl}) — found by Claude` } });
    }
    verified.push({ business_id: business.id, email: it.email, eligibility: evaluated.eligibility, reason: evaluated.eligibilityReason ?? "" });
    await addEvent({ workspaceId: ws, id: c.task?.id }, "CONTACT_VERIFIED", `Verified ${it.email} for ${business.name} on ${host} — ${evaluated.eligibility.toLowerCase().replace("_", " ")}`, { businessId: business.id });
  }
  if (c.task) await bumpStats(c.task.id, { contactsVerified: verified.length, contactsRejected: rejected.length });
  return { verified, rejected, note: "ELIGIBLE means CASL allows a first business email; NEEDS_REVIEW means the user must confirm consent first. Nothing is sent without the user's approval." };
}

// ───────────── Facts ─────────────

const normField = (f: string) => f.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
const REVENUE = /revenue|turnover|income|sales_volume|earnings/;

export async function submitFacts(c: Ctx, businessId: string, facts: z.infer<typeof FactItem>[]) {
  const ws = c.conn.workspaceId;
  const business = await businessInWorkspace(ws, businessId);
  const saved: { field: string; kind: string; verified: boolean }[] = [];
  const rejected: { field: string; reason: string }[] = [];
  const pages = new Map<string, string | null>();
  const existing = new Set((await db.businessEvidence.findMany({ where: { businessId }, select: { field: true, value: true } })).map((e) => `${e.field}|${e.value}`));
  let image: string | null = null;
  for (const f of facts.slice(0, 30)) {
    const field = normField(f.field);
    if (!field) continue;
    if (f.kind === "fact" && !f.source_url) {
      rejected.push({ field, reason: "facts need a source_url — send your own judgement as kind \"estimate\"" });
      continue;
    }
    if (REVENUE.test(field) && (f.kind !== "fact" || !f.source_url)) {
      rejected.push({ field, reason: "revenue is only recorded when a public source states it — don't estimate it" });
      continue;
    }
    const isPhoto = /photo|image|logo/.test(field);
    if (isPhoto && !/^https?:\/\//i.test(f.value)) {
      rejected.push({ field, reason: "photos must be an image URL" });
      continue;
    }
    if (existing.has(`${field}|${f.value}`)) continue;
    let verified = false;
    if (f.kind === "fact" && f.source_url && f.value.length <= 80 && !isPhoto) {
      if (!pages.has(f.source_url) && pages.size < 4) pages.set(f.source_url, await fetchPage(f.source_url).then((p) => p.text.toLowerCase(), () => null));
      const text = pages.get(f.source_url);
      if (text) verified = text.includes(f.value.toLowerCase().replace(/\s+/g, " "));
    }
    await db.businessEvidence.create({ data: { workspaceId: ws, businessId, taskId: c.task?.id ?? null, field, value: f.value, kind: f.kind === "fact" ? "FACT" : "ESTIMATE", sourceUrl: f.source_url ?? null, sourceType: f.source_url ? f.source_type : null, confidence: f.confidence ?? null, verified, createdBy: "CLAUDE" } });
    existing.add(`${field}|${f.value}`);
    saved.push({ field, kind: f.kind, verified });
    if (isPhoto && !image) image = f.value;
  }
  if (image && !business.imageUrl) await db.business.update({ where: { id: businessId }, data: { imageUrl: image } });
  if (saved.length) {
    const v = saved.filter((s) => s.verified).length;
    await addEvent({ workspaceId: ws, id: c.task?.id }, "FACTS_ADDED", `Researched ${business.name}: ${saved.length} fact${saved.length === 1 ? "" : "s"}${v ? ` (${v} confirmed on the source page)` : ""}`, { businessId });
    if (c.task) await bumpStats(c.task.id, { facts: saved.length });
  }
  return { saved: saved.length, verified_on_page: saved.filter((s) => s.verified).length, rejected };
}

// ───────────── Email drafts (approval required) ─────────────

export async function createEmailDraft(c: Ctx, a: { business_id: string; subject: string; body: string; purpose: "outreach" | "quote" }) {
  const ws = c.conn.workspaceId;
  const business = await businessInWorkspace(ws, a.business_id);
  if (business.doNotContact) throw new AppError("FORBIDDEN", `${business.name} is marked Do Not Contact — no email can be drafted.`);
  const { company } = await getSettings(ws);
  const issues = scanCommitments(`${a.subject}\n${a.body}`, company);
  const { saveOutreachDraft } = await import("../email/drafts");
  const { draft, to: primary, blocker } = await saveOutreachDraft({
    workspaceId: ws, businessId: business.id, subject: a.subject, body: a.body, userId: actor(c), source: "Claude",
    notes: [`Written by Claude (${a.purpose === "quote" ? "detailed quote" : "outreach"}) — review before sending.`, ...issues],
  });
  await addEvent({ workspaceId: ws, id: c.task?.id }, "DRAFT_CREATED", `Drafted ${a.purpose === "quote" ? "a quote email" : "an email"} to ${business.name} — waiting for your approval`, { businessId: business.id });
  if (c.task) await bumpStats(c.task.id, { drafts: 1 });
  const owner = actor(c);
  await notify({ workspaceId: ws, type: "AI_DRAFT_READY", title: `Claude drafted ${a.purpose === "quote" ? "a quote" : "an email"} for ${business.name}`, body: "Review it, edit if needed, and send it from WebScout.", link: `/leads/${business.id}?tab=emails`, ...(owner ? { onlyUserId: owner } : {}) });
  return {
    draft_id: draft.id,
    to: primary || null,
    status: "Saved as a draft. The user reviews and sends it from WebScout — it has NOT been sent.",
    send_check: blocker ? `Can't be sent yet: ${blocker}` : "Passes the sending checks — ready for the user's approval.",
    price_warnings: issues,
    review_link: `${appUrl()}/leads/${business.id}?tab=emails`,
  };
}

// ───────────── Reading the CRM ─────────────

export async function searchLeads(workspaceId: string, a: { query?: string; status?: string; city?: string; has_email?: boolean; limit?: number }) {
  const q = a.query?.trim();
  const rows = await db.business.findMany({
    where: {
      workspaceId, archived: false,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { websiteDomain: { contains: q.toLowerCase() } }] } : {}),
      ...(a.status ? { status: a.status as Business["status"] } : {}),
      ...(a.city ? { city: { contains: a.city, mode: "insensitive" } } : {}),
      ...(a.has_email ? { email: { not: null } } : {}),
    },
    orderBy: [{ opportunityScore: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }],
    take: Math.min(50, Math.max(1, a.limit ?? 20)),
    select: { id: true, name: true, category: true, city: true, region: true, status: true, website: true, phone: true, email: true, websiteClass: true, opportunityScore: true, doNotContact: true },
  });
  return { count: rows.length, leads: rows.map((r) => ({ business_id: r.id, name: r.name, category: r.category, location: where(r), status: r.status, website: r.website, phone: r.phone, email: r.email, website_rating: r.websiteClass, opportunity_score: r.opportunityScore, do_not_contact: r.doNotContact })) };
}

export async function leadProfile(workspaceId: string, businessId: string) {
  const b = await businessInWorkspace(workspaceId, businessId);
  const [audit, opp, contacts, evidence, draft] = await Promise.all([
    db.websiteAudit.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { classification: true, overallScore: true, scores: true, summary: true, createdAt: true } }),
    db.opportunity.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { score: true, summary: true, reasons: true, recommendedFeatures: true } }),
    db.contact.findMany({ where: { businessId, email: { not: null } }, select: { email: true, role: true, eligibility: true, eligibilityReason: true, sourceUrl: true } }),
    db.businessEvidence.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 40, select: { field: true, value: true, kind: true, sourceUrl: true, verified: true } }),
    db.emailMessage.findFirst({ where: { businessId, status: "DRAFT", kind: "OUTREACH" }, select: { id: true, subject: true, toAddress: true } }),
  ]);
  return {
    business_id: b.id, name: b.name, category: b.category, address: b.address, location: where(b), country: b.country, phone: b.phone, website: b.website, email: b.email,
    status: b.status, do_not_contact: b.doNotContact, rating: b.rating, review_count: b.reviewCount, coordinates: b.latitude != null ? { lat: b.latitude, lng: b.longitude } : null,
    website_audit: audit ? { rating: audit.classification, overall_score: audit.overallScore, scores: audit.scores, summary: audit.summary, audited_at: audit.createdAt } : null,
    opportunity: opp,
    contacts,
    research: evidence,
    pending_draft: draft,
    link: `${appUrl()}/leads/${b.id}`,
  };
}
