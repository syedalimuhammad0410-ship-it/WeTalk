import "./guard";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "./errors";
import { getPlaybook } from "./intel/playbooks";
import { csvCell, leadWhere, type LeadFiltersT } from "./queries";
import { EXPORT_COLUMNS, type ExportColumnId } from "../export-columns";
import type { ExtractedFacts } from "./audit/service";

/** Everything any export column or the PDF report needs for one lead. */
const LEAD_INCLUDE = {
  tags: { select: { tag: { select: { name: true } } } },
  campaignLeads: { select: { campaign: { select: { name: true } } } },
  assignedTo: { select: { name: true } },
  audits: { where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1, include: { findings: { orderBy: { severity: "asc" } } } },
  opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
  notes: { orderBy: { createdAt: "desc" }, take: 3, select: { body: true, createdAt: true } },
  prompts: { orderBy: { updatedAt: "desc" }, take: 1, select: { qualityScore: true, updatedAt: true } },
  _count: { select: { messages: { where: { direction: "OUTBOUND", status: "SENT" } } } },
} satisfies Prisma.BusinessInclude;
export type ExportLead = Prisma.BusinessGetPayload<{ include: typeof LEAD_INCLUDE }>;

type Reason = { label: string; points: number; kind: string };
type Feature = { name: string; priority: string; status: string; why?: string };
export const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "");

export function leadReasons(l: ExportLead): Reason[] {
  return ((l.opportunities[0]?.reasons as Reason[] | undefined) ?? []).filter((r) => r.points > 0);
}
export function leadMissingFeatures(l: ExportLead): Feature[] {
  return ((l.opportunities[0]?.recommendedFeatures as Feature[] | undefined) ?? []).filter((f) => f.status !== "present");
}

const facts = (l: ExportLead) => (l.audits[0]?.extracted ?? null) as Partial<ExtractedFacts> | null;

/** One or two sentences on what the business does: the audit's reading of their own site, their site's description, or what Google knows. */
export function leadDescription(l: ExportLead): string {
  const ex = facts(l);
  const fromSite = ex?.ai?.summary?.trim() || ex?.metaDescription?.trim();
  if (fromSite) return fromSite;
  const kind = l.category ? l.category.replace(/^\w/, (c) => c.toUpperCase()) : getPlaybook(l.businessType).label;
  const rated = l.rating != null ? `, rated ${l.rating}/5 from ${l.reviewCount ?? 0} Google reviews` : "";
  return `${kind}${l.city ? ` in ${l.city}` : ""}${rated}.`;
}
/** Services the business's own website says it offers (from the audit). */
export function leadServices(l: ExportLead): string[] {
  return (facts(l)?.ai?.services ?? []).map((s) => s.name).filter(Boolean).slice(0, 12);
}
export function leadSocials(l: ExportLead): string[] {
  const links = (l.socialLinks ?? {}) as Record<string, string>;
  return Object.values(links).filter((v) => typeof v === "string" && v);
}

/** Value of one export column for one lead (plain text). */
export function columnValue(id: ExportColumnId, l: ExportLead): string | number | null {
  const audit = l.audits[0];
  switch (id) {
    case "name": return l.name;
    case "type": return getPlaybook(l.businessType).label;
    case "category": return l.category;
    case "description": return leadDescription(l);
    case "services": return leadServices(l).join("; ");
    case "socials": return leadSocials(l).join("; ");
    case "status": return human(l.status);
    case "address": return l.address;
    case "city": return l.city;
    case "region": return l.region;
    case "postalCode": return l.postalCode;
    case "phone": return l.phone;
    case "email": return l.email;
    case "website": return l.website;
    case "googleMapsUrl": return l.googleMapsUrl;
    case "rating": return l.rating;
    case "reviewCount": return l.reviewCount;
    case "hours": return l.hours.join("; ");
    case "websiteStatus": return human(l.websiteStatus);
    case "websiteClass": return human(l.websiteClass);
    case "websiteScore": return l.websiteScore;
    case "opportunityScore": return l.opportunityScore;
    case "leadScore": return l.leadScore;
    case "auditSummary": return audit?.aiSummary || audit?.summary || "";
    case "topIssues": return (audit?.findings ?? []).filter((f) => f.severity === "HIGH").slice(0, 5).map((f) => f.title).join("; ");
    case "opportunityReasons": return leadReasons(l).slice(0, 5).map((r) => r.label).join("; ");
    case "missingFeatures": return leadMissingFeatures(l).slice(0, 6).map((f) => f.name).join("; ");
    case "promptQuality": return l.prompts[0]?.qualityScore ?? null;
    case "emailsSent": return l._count.messages;
    case "lastContacted": return fmtDate(l.lastContactedAt);
    case "lastResponse": return fmtDate(l.lastResponseAt);
    case "responseStatus": return l.lastResponseAt ? "Responded" : l.lastContactedAt ? "Awaiting reply" : "Not contacted";
    case "lastIntent": return human(l.lastIntent);
    case "doNotContact": return l.doNotContact ? "Yes" : "No";
    case "tags": return l.tags.map((t) => t.tag.name).join("; ");
    case "campaigns": return l.campaignLeads.map((c) => c.campaign.name).join("; ");
    case "assignedTo": return l.assignedTo?.name ?? "";
    case "latestNote": return l.notes[0]?.body ?? "";
    case "source": return human(l.source);
    case "discoveredAt": return fmtDate(l.discoveredAt);
  }
}

export type ExportRequest = { filters?: Partial<LeadFiltersT>; ids?: string[]; columns: ExportColumnId[] };

export async function loadExportLeads(workspaceId: string, req: ExportRequest, limit: number) {
  const where = req.ids?.length ? { workspaceId, id: { in: req.ids } } : leadWhere(workspaceId, req.filters ?? {});
  const total = await db.business.count({ where });
  const leads = await db.business.findMany({ where, orderBy: [{ opportunityScore: { sort: "desc", nulls: "last" } }, { name: "asc" }], take: limit, include: LEAD_INCLUDE });
  return { leads, total };
}

export async function exportCsv(workspaceId: string, req: ExportRequest) {
  const cols = req.columns.filter((c) => EXPORT_COLUMNS.some((x) => x.id === c));
  if (!cols.length) throw new AppError("VALIDATION", "Choose at least one column to export.");
  const { leads } = await loadExportLeads(workspaceId, req, 20_000);
  const header = cols.map((c) => EXPORT_COLUMNS.find((x) => x.id === c)!.label);
  const lines = leads.map((l) => cols.map((c) => csvCell(columnValue(c, l))).join(","));
  // BOM so Excel opens UTF-8 (accents, dashes) correctly.
  return { csv: "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n", count: leads.length };
}

/** Data for one visual lead card (the PNG "lead cards" export, drawn in the browser). */
export function leadCard(l: ExportLead) {
  return {
    name: l.name,
    type: getPlaybook(l.businessType).label,
    category: l.category,
    city: l.city,
    description: leadDescription(l),
    services: leadServices(l).slice(0, 6),
    address: l.address,
    phone: l.phone,
    email: l.email,
    website: l.website,
    rating: l.rating,
    reviewCount: l.reviewCount,
    websiteLabel: human(l.websiteClass ?? l.websiteStatus),
    opportunityScore: l.opportunityScore,
    status: human(l.status),
  };
}
export type LeadCard = ReturnType<typeof leadCard>;
