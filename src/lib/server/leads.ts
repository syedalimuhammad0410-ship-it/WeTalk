import "./guard";
import type { Business, BusinessSource, LeadStatus, Prisma } from "@prisma/client";
import { db } from "../db";
import { logActivity } from "./activity";
import { AppError } from "./errors";
import { LEAD_STATUS_META } from "../constants";

// ───────────── Normalisation & de-duplication ─────────────

const NAME_STOPWORDS = /\b(the|inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|company|plc|pllc|pc|lp)\b/g;

export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(NAME_STOPWORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Hosts that many unrelated businesses share; never used as a dedupe key. */
const SHARED_HOSTS = [
  "facebook.com", "instagram.com", "linktr.ee", "google.com", "business.site", "sites.google.com", "yelp.com",
  "wixsite.com", "squarespace.com", "godaddysites.com", "weebly.com", "wordpress.com", "blogspot.com",
  "tiktok.com", "twitter.com", "x.com", "linkedin.com", "youtube.com", "ubereats.com", "doordash.com",
  "skipthedishes.com", "opentable.com", "booksy.com", "vagaro.com", "fresha.com", "square.site", "toasttab.com",
];

export function normalizeWebsite(url: string | null | undefined): { url: string; domain: string | null } | null {
  if (!url) return null;
  let raw = url.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    const shared = SHARED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    return { url: u.toString(), domain: shared ? null : host };
  } catch {
    return null;
  }
}

export function isSocialOrDirectoryUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return ["facebook.com", "instagram.com", "linktr.ee", "yelp.com", "tiktok.com", "twitter.com", "x.com", "linkedin.com", "youtube.com"].some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

export type BusinessInput = {
  name: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  emailSource?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  hours?: string[];
  googleMapsUrl?: string | null;
  operationalStatus?: string | null;
  source: BusinessSource;
  sourceId?: string | null;
  types?: string[];
  isDemo?: boolean;
};

export async function findDuplicate(workspaceId: string, input: BusinessInput) {
  if (input.sourceId) {
    const bySource = await db.business.findFirst({ where: { workspaceId, source: input.source, sourceId: input.sourceId } });
    if (bySource) return { business: bySource, reason: "same source identifier" };
  }
  const site = normalizeWebsite(input.website);
  if (site?.domain) {
    const byDomain = await db.business.findFirst({ where: { workspaceId, websiteDomain: site.domain } });
    if (byDomain) return { business: byDomain, reason: "same website domain" };
  }
  const phone = normalizePhone(input.phone);
  const name = normalizeName(input.name);
  if (phone) {
    const byPhone = await db.business.findFirst({ where: { workspaceId, normalizedPhone: phone } });
    if (byPhone && (byPhone.normalizedName === name || similarNames(byPhone.normalizedName, name))) {
      return { business: byPhone, reason: "same phone number and name" };
    }
  }
  if (name && (input.postalCode || input.city || input.address)) {
    const candidates = await db.business.findMany({ where: { workspaceId, normalizedName: name }, take: 10 });
    const match = candidates.find(
      (c) =>
        (input.postalCode && c.postalCode && c.postalCode.replace(/\s/g, "").toLowerCase() === input.postalCode.replace(/\s/g, "").toLowerCase()) ||
        (input.address && c.address && normalizeName(c.address) === normalizeName(input.address)),
    );
    if (match) return { business: match, reason: "same name and address" };
  }
  return null;
}

function similarNames(a: string, b: string) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Creates a business unless a duplicate exists. Missing values are kept null —
 * never invented. Returns { business, created, duplicateReason }.
 */
export async function upsertBusiness(workspaceId: string, input: BusinessInput, userId?: string | null) {
  const name = input.name.trim();
  if (!name) throw new AppError("VALIDATION", "Business name is required.");
  const dup = await findDuplicate(workspaceId, input);
  const site = normalizeWebsite(input.website);
  if (dup) {
    // Fill gaps on the existing record with newly available values (never overwrite with blanks).
    const patch: Prisma.BusinessUpdateInput = {};
    const e = dup.business;
    if (!e.phone && input.phone) {
      patch.phone = input.phone;
      patch.normalizedPhone = normalizePhone(input.phone);
    }
    if (!e.website && site) {
      patch.website = site.url;
      patch.websiteDomain = site.domain;
      patch.websiteStatus = "WEBSITE_FOUND";
    }
    if (!e.address && input.address) patch.address = input.address;
    if (input.source === e.source && input.sourceId === e.sourceId) {
      if (input.rating != null) patch.rating = input.rating;
      if (input.reviewCount != null) patch.reviewCount = input.reviewCount;
      if (input.hours?.length) patch.hours = input.hours;
      if (input.operationalStatus) patch.operationalStatus = input.operationalStatus;
      patch.sourceFetchedAt = new Date();
    }
    const business = Object.keys(patch).length ? await db.business.update({ where: { id: e.id }, data: patch }) : e;
    return { business, created: false, duplicateReason: dup.reason };
  }
  const business = await db.business.create({
    data: {
      workspaceId,
      name,
      normalizedName: normalizeName(name),
      category: input.category ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      country: input.country ?? null,
      postalCode: input.postalCode ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      phone: input.phone ?? null,
      normalizedPhone: normalizePhone(input.phone),
      website: site?.url ?? null,
      websiteDomain: site?.domain ?? null,
      websiteStatus: site ? "WEBSITE_FOUND" : input.source === "GOOGLE_PLACES" ? "NO_WEBSITE" : "UNKNOWN",
      websiteClass: !site && input.source === "GOOGLE_PLACES" ? "NO_WEBSITE" : null,
      email: input.email?.toLowerCase() ?? null,
      emailSource: input.email ? (input.emailSource ?? "Entered manually") : null,
      rating: input.rating ?? null,
      reviewCount: input.reviewCount ?? null,
      hours: input.hours ?? [],
      googleMapsUrl: input.googleMapsUrl ?? null,
      operationalStatus: input.operationalStatus ?? null,
      source: input.source,
      sourceId: input.sourceId ?? null,
      sourceFetchedAt: input.source === "GOOGLE_PLACES" ? new Date() : null,
      isDemo: input.isDemo ?? false,
      socialLinks: site && isSocialOrDirectoryUrl(site.url) ? { primary: site.url } : {},
      statusHistory: { create: { workspaceId, toStatus: "NEW", changedById: userId ?? null, reason: "Discovered" } },
      contacts: input.email
        ? { create: { workspaceId, email: input.email.toLowerCase(), source: input.emailSource ?? "Entered manually", isPrimary: true } }
        : undefined,
    },
  });
  await logActivity({
    workspaceId,
    userId,
    businessId: business.id,
    action: "lead.discovered",
    summary: `Business discovered via ${sourceLabel(input.source)}`,
  });
  return { business, created: true, duplicateReason: null };
}

export const sourceLabel = (s: BusinessSource) =>
  ({ GOOGLE_PLACES: "Google Places", MANUAL: "manual entry", CSV_IMPORT: "CSV import", DEMO: "demo data" })[s];

// ───────────── Status changes ─────────────

/** Order used for automatic (system-driven) progression; manual changes may move anywhere. */
const STATUS_RANK: Record<LeadStatus, number> = {
  NEW: 0,
  RESEARCHED: 1,
  HIGH_OPPORTUNITY: 2,
  CONTACTED: 3,
  FOLLOW_UP: 4,
  RESPONDED: 5,
  AI_RESPONSE_READY: 6,
  INTERESTED: 7,
  MEETING: 8,
  PROPOSAL: 9,
  WON: 10,
  LOST: 10,
  DO_NOT_CONTACT: 11,
};

const TERMINAL: LeadStatus[] = ["WON", "LOST", "DO_NOT_CONTACT"];

export async function changeLeadStatus(input: {
  workspaceId: string;
  businessId: string;
  to: LeadStatus;
  userId?: string | null;
  reason?: string;
  /** System-driven changes only move forward and never leave terminal states. */
  automatic?: boolean;
}) {
  const business = await db.business.findFirst({ where: { id: input.businessId, workspaceId: input.workspaceId } });
  if (!business) throw new AppError("NOT_FOUND", "Lead not found.");
  const from = business.status;
  if (from === input.to) return business;
  if (input.automatic) {
    if (TERMINAL.includes(from)) return business;
    if (business.doNotContact && input.to !== "DO_NOT_CONTACT") return business;
    if (STATUS_RANK[input.to] <= STATUS_RANK[from] && !["FOLLOW_UP", "AI_RESPONSE_READY", "RESPONDED"].includes(input.to)) return business;
  }
  const data: Prisma.BusinessUpdateInput = { status: input.to, statusChangedAt: new Date() };
  if (input.to === "DO_NOT_CONTACT") {
    data.doNotContact = true;
    data.doNotContactAt = new Date();
    data.doNotContactReason = input.reason ?? "Marked do not contact";
    data.aiPaused = true;
  } else if (from === "DO_NOT_CONTACT") {
    data.doNotContact = false;
    data.doNotContactAt = null;
    data.doNotContactReason = null;
  }
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.business.update({ where: { id: business.id }, data });
    await tx.leadStatusChange.create({
      data: { workspaceId: input.workspaceId, businessId: business.id, fromStatus: from, toStatus: input.to, changedById: input.userId ?? null, reason: input.reason },
    });
    if (["DO_NOT_CONTACT", "WON", "LOST"].includes(input.to)) {
      await tx.followUp.updateMany({
        where: { businessId: business.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } },
        data: { status: "CANCELLED", cancelReason: `Lead moved to ${LEAD_STATUS_META[input.to].label}` },
      });
    }
    if (input.to === "DO_NOT_CONTACT") {
      await tx.aiResponseDraft.updateMany({ where: { businessId: business.id, status: "PENDING" }, data: { status: "SUPERSEDED" } });
      const emails = new Set<string>();
      if (business.email) emails.add(business.email.toLowerCase());
      const contacts = await tx.contact.findMany({ where: { businessId: business.id, email: { not: null } }, select: { email: true } });
      contacts.forEach((c) => c.email && emails.add(c.email.toLowerCase()));
      for (const value of emails) {
        await tx.suppressionEntry.upsert({
          where: { workspaceId_value: { workspaceId: input.workspaceId, value } },
          create: { workspaceId: input.workspaceId, value, reason: input.reason ?? "Do not contact" },
          update: {},
        });
      }
    }
    if (from === "DO_NOT_CONTACT") {
      const emails = [business.email?.toLowerCase()].filter(Boolean) as string[];
      if (emails.length) await tx.suppressionEntry.deleteMany({ where: { workspaceId: input.workspaceId, value: { in: emails } } });
    }
    await logActivity(
      {
        workspaceId: input.workspaceId,
        userId: input.userId,
        businessId: business.id,
        action: "lead.status_changed",
        summary: `Status changed from ${LEAD_STATUS_META[from].label} to ${LEAD_STATUS_META[input.to].label}${input.reason ? ` — ${input.reason}` : ""}`,
        details: { from, to: input.to, automatic: Boolean(input.automatic) },
      },
      tx,
    );
    return updated;
  });
  return updated;
}

export async function getLeadOrThrow(workspaceId: string, id: string): Promise<Business> {
  const b = await db.business.findFirst({ where: { id, workspaceId } });
  if (!b) throw new AppError("NOT_FOUND", "Lead not found in this workspace.");
  return b;
}

/** Is this recipient suppressed (do-not-contact list, unsubscribed, or business flagged)? */
export async function isSuppressed(workspaceId: string, email: string) {
  const lower = email.toLowerCase();
  const domain = lower.split("@")[1];
  const hit = await db.suppressionEntry.findFirst({
    where: { workspaceId, value: { in: [lower, ...(domain ? [`@${domain}`] : [])] } },
  });
  return hit;
}
