import "./guard";
import * as z from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { LEAD_STATUSES } from "../constants";

const csv = z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : []), z.array(z.string()));
const optNum = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().optional());
const optDate = z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional());

export const LeadFilters = z.object({
  q: z.string().trim().max(200).optional(),
  status: csv.pipe(z.array(z.enum(LEAD_STATUSES))).optional(),
  city: z.string().trim().optional(),
  category: z.string().trim().optional(),
  businessType: z.string().trim().optional(),
  websiteStatus: csv.optional(),
  websiteClass: csv.optional(),
  minWebsiteScore: optNum,
  maxWebsiteScore: optNum,
  minOpportunity: optNum,
  maxOpportunity: optNum,
  response: z.enum(["any", "replied", "no_reply", "not_contacted"]).optional(),
  campaignId: z.string().optional(),
  discoveredFrom: optDate,
  discoveredTo: optDate,
  contactedFrom: optDate,
  contactedTo: optDate,
  assignedToId: z.string().optional(),
  tagIds: csv.optional(),
  hasEmail: z.enum(["yes", "no"]).optional(),
  archived: z.enum(["yes", "no", "all"]).optional(),
  demo: z.enum(["yes", "no", "all"]).optional(),
  sort: z.enum(["newest", "oldest", "opportunity", "website_score", "name", "last_contacted", "lead_score"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
export type LeadFiltersT = z.infer<typeof LeadFilters>;

export function leadWhere(workspaceId: string, f: Partial<LeadFiltersT>): Prisma.BusinessWhereInput {
  const and: Prisma.BusinessWhereInput[] = [{ workspaceId }];
  if (f.archived !== "all") and.push({ archived: f.archived === "yes" });
  if (f.demo === "yes") and.push({ isDemo: true });
  if (f.demo === "no") and.push({ isDemo: false });
  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { city: { contains: q, mode: "insensitive" } },
        { website: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.city) and.push({ city: { contains: f.city, mode: "insensitive" } });
  if (f.category) and.push({ category: { contains: f.category, mode: "insensitive" } });
  if (f.businessType) and.push({ businessType: f.businessType });
  if (f.websiteStatus?.length) and.push({ websiteStatus: { in: f.websiteStatus as Prisma.EnumWebsiteStatusFilter["in"] } });
  if (f.websiteClass?.length) and.push({ websiteClass: { in: f.websiteClass as Prisma.EnumWebsiteClassNullableFilter["in"] } });
  if (f.minWebsiteScore != null) and.push({ websiteScore: { gte: f.minWebsiteScore } });
  if (f.maxWebsiteScore != null) and.push({ websiteScore: { lte: f.maxWebsiteScore } });
  if (f.minOpportunity != null) and.push({ opportunityScore: { gte: f.minOpportunity } });
  if (f.maxOpportunity != null) and.push({ opportunityScore: { lte: f.maxOpportunity } });
  if (f.response === "replied") and.push({ lastResponseAt: { not: null } });
  if (f.response === "no_reply") and.push({ lastContactedAt: { not: null }, lastResponseAt: null });
  if (f.response === "not_contacted") and.push({ lastContactedAt: null });
  if (f.campaignId) and.push({ campaignLeads: { some: { campaignId: f.campaignId } } });
  if (f.discoveredFrom || f.discoveredTo) and.push({ discoveredAt: { gte: f.discoveredFrom, lte: f.discoveredTo } });
  if (f.contactedFrom || f.contactedTo) and.push({ lastContactedAt: { gte: f.contactedFrom, lte: f.contactedTo } });
  if (f.assignedToId) and.push({ assignedToId: f.assignedToId === "unassigned" ? null : f.assignedToId });
  if (f.tagIds?.length) and.push({ tags: { some: { tagId: { in: f.tagIds } } } });
  if (f.hasEmail === "yes") and.push({ email: { not: null } });
  if (f.hasEmail === "no") and.push({ email: null });
  return { AND: and };
}

const SORTS: Record<NonNullable<LeadFiltersT["sort"]>, Prisma.BusinessOrderByWithRelationInput[]> = {
  newest: [{ discoveredAt: "desc" }],
  oldest: [{ discoveredAt: "asc" }],
  opportunity: [{ opportunityScore: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }],
  website_score: [{ websiteScore: { sort: "asc", nulls: "last" } }],
  name: [{ name: "asc" }],
  last_contacted: [{ lastContactedAt: { sort: "desc", nulls: "last" } }],
  lead_score: [{ leadScore: { sort: "desc", nulls: "last" } }],
};

export async function listLeads(workspaceId: string, f: LeadFiltersT) {
  const where = leadWhere(workspaceId, f);
  const [total, rows] = await Promise.all([
    db.business.count({ where }),
    db.business.findMany({
      where,
      orderBy: SORTS[f.sort ?? "newest"],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true, name: true, category: true, businessType: true, city: true, region: true, phone: true, email: true, website: true,
        status: true, statusChangedAt: true, websiteStatus: true, websiteClass: true, websiteScore: true, opportunityScore: true, leadScore: true,
        lastContactedAt: true, lastResponseAt: true, discoveredAt: true, doNotContact: true, isDemo: true, archived: true, rating: true, reviewCount: true,
        assignedTo: { select: { id: true, name: true } },
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      },
    }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, rows };
}

export async function pipelineColumns(workspaceId: string, f: Partial<LeadFiltersT>) {
  const where = leadWhere(workspaceId, { ...f, status: undefined });
  const grouped = await db.business.groupBy({ by: ["status"], where, _count: true });
  const leads = await Promise.all(
    LEAD_STATUSES.map((s) =>
      db.business.findMany({
        where: { AND: [where, { status: s }] },
        orderBy: [{ statusChangedAt: "desc" }],
        take: 30,
        select: { id: true, name: true, city: true, category: true, opportunityScore: true, websiteScore: true, websiteClass: true, statusChangedAt: true, doNotContact: true, isDemo: true, email: true },
      }),
    ),
  );
  return LEAD_STATUSES.map((s, i) => ({ status: s, count: grouped.find((g) => g.status === s)?._count ?? 0, leads: leads[i]! }));
}

export async function dashboardStats(workspaceId: string) {
  const base = { workspaceId, archived: false };
  const [businesses, analyzed, high, sent, responses, interested, meetings, customers, pendingDrafts, reviewQueue, dueFollowUps] = await Promise.all([
    db.business.count({ where: base }),
    db.business.count({ where: { ...base, websiteClass: { not: null } } }),
    db.business.count({ where: { ...base, opportunityScore: { gte: 70 } } }),
    db.emailMessage.count({ where: { workspaceId, direction: "OUTBOUND", status: "SENT" } }),
    db.emailMessage.count({ where: { workspaceId, direction: "INBOUND" } }),
    db.business.count({ where: { ...base, status: { in: ["INTERESTED", "MEETING", "PROPOSAL", "WON"] } } }),
    db.leadStatusChange.groupBy({ by: ["businessId"], where: { workspaceId, toStatus: "MEETING" } }).then((r) => r.length),
    db.business.count({ where: { ...base, status: "WON" } }),
    db.aiResponseDraft.count({ where: { workspaceId, status: "PENDING" } }),
    db.conversation.count({ where: { workspaceId, needsHumanReview: true } }),
    db.followUp.count({ where: { workspaceId, status: "PENDING_APPROVAL" } }),
  ]);
  return { businesses, analyzed, high, sent, responses, interested, meetings, customers, pendingDrafts, reviewQueue, dueFollowUps };
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function analytics(workspaceId: string, from: Date, to: Date) {
  const range = { gte: from, lte: to };
  const [leads, audits, oppLeads, highOpp, outbound, failed, inbound, contactedIds, statusChanges, avgLead] = await Promise.all([
    db.business.count({ where: { workspaceId, discoveredAt: range } }),
    db.websiteAudit.count({ where: { workspaceId, status: "COMPLETED", completedAt: range } }),
    db.business.count({ where: { workspaceId, discoveredAt: range, opportunityScore: { not: null } } }),
    db.business.count({ where: { workspaceId, discoveredAt: range, opportunityScore: { gte: 70 } } }),
    db.emailMessage.findMany({ where: { workspaceId, direction: "OUTBOUND", status: "SENT", sentAt: range }, select: { businessId: true, sentAt: true, kind: true, campaignId: true } }),
    db.emailMessage.count({ where: { workspaceId, direction: "OUTBOUND", status: { in: ["FAILED", "BOUNCED"] }, createdAt: range } }),
    db.emailMessage.findMany({ where: { workspaceId, direction: "INBOUND", receivedAt: range }, select: { businessId: true, receivedAt: true, intent: true, campaignId: true, business: { select: { businessType: true, category: true } } } }),
    db.emailMessage.findMany({ where: { workspaceId, direction: "OUTBOUND", status: "SENT", kind: "OUTREACH", sentAt: range }, select: { businessId: true, sentAt: true, campaignId: true }, distinct: ["businessId"] }),
    db.leadStatusChange.findMany({ where: { workspaceId, createdAt: range, toStatus: { in: ["MEETING", "WON", "INTERESTED"] } }, select: { businessId: true, toStatus: true, createdAt: true } }),
    db.business.aggregate({ where: { workspaceId, leadScore: { not: null } }, _avg: { leadScore: true } }),
  ]);
  const contacted = new Set(contactedIds.map((c) => c.businessId).filter(Boolean) as string[]);
  const replied = new Set(inbound.map((m) => m.businessId).filter((b): b is string => Boolean(b) && contacted.has(b!)));
  const positiveIntents = ["INTERESTED", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL", "PRICING", "QUESTION"];
  const positive = new Set(inbound.filter((m) => m.businessId && contacted.has(m.businessId) && positiveIntents.includes(m.intent ?? "")).map((m) => m.businessId!));
  const meetings = new Set(statusChanges.filter((s) => s.toStatus === "MEETING" && contacted.has(s.businessId)).map((s) => s.businessId));
  const won = new Set(statusChanges.filter((s) => s.toStatus === "WON" && contacted.has(s.businessId)).map((s) => s.businessId));

  // Average response time: first inbound after first outreach, per business.
  const firstOut = new Map(contactedIds.map((c) => [c.businessId!, c.sentAt!]));
  const times: number[] = [];
  const seen = new Set<string>();
  for (const m of [...inbound].sort((a, b) => a.receivedAt!.getTime() - b.receivedAt!.getTime())) {
    if (!m.businessId || seen.has(m.businessId)) continue;
    const out = firstOut.get(m.businessId);
    if (out && m.receivedAt! > out) {
      times.push((m.receivedAt!.getTime() - out.getTime()) / 3600_000);
      seen.add(m.businessId);
    }
  }

  // Time series by day
  const days: string[] = [];
  for (let d = new Date(from); d <= to && days.length < 400; d = new Date(d.getTime() + 86400_000)) days.push(dayKey(d));
  const series = days.map((day) => ({
    day,
    sent: outbound.filter((m) => dayKey(m.sentAt!) === day).length,
    responses: inbound.filter((m) => dayKey(m.receivedAt!) === day).length,
    interested: inbound.filter((m) => dayKey(m.receivedAt!) === day && positiveIntents.slice(0, 4).includes(m.intent ?? "")).length,
  }));
  const byCategory = new Map<string, { contacted: number; responses: number }>();
  const contactedBiz = await db.business.findMany({ where: { id: { in: Array.from(contacted) } }, select: { id: true, businessType: true } });
  for (const b of contactedBiz) {
    const k = b.businessType ?? "general";
    const cur = byCategory.get(k) ?? { contacted: 0, responses: 0 };
    cur.contacted++;
    if (replied.has(b.id)) cur.responses++;
    byCategory.set(k, cur);
  }
  const campaigns = await db.campaign.findMany({ where: { workspaceId }, select: { id: true, name: true } });
  const byCampaign = campaigns
    .map((c) => {
      const ids = new Set(contactedIds.filter((x) => x.campaignId === c.id).map((x) => x.businessId));
      return { name: c.name, contacted: ids.size, responses: Array.from(ids).filter((id) => id && replied.has(id)).length };
    })
    .filter((c) => c.contacted > 0);
  const intents = inbound.reduce<Record<string, number>>((acc, m) => ((acc[m.intent ?? "UNCLASSIFIED"] = (acc[m.intent ?? "UNCLASSIFIED"] ?? 0) + 1), acc), {});
  const rate = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    totals: {
      leads,
      audits,
      emailsSent: outbound.length,
      failed,
      responses: inbound.length,
      contacted: contacted.size,
      replied: replied.size,
      positive: positive.size,
      meetings: meetings.size,
      won: won.size,
    },
    rates: {
      leadGenerationPerDay: leads / Math.max(1, days.length),
      websiteOpportunityRate: rate(highOpp, oppLeads),
      deliveryRate: rate(outbound.length, outbound.length + failed),
      responseRate: rate(replied.size, contacted.size),
      positiveResponseRate: rate(positive.size, contacted.size),
      meetingRate: rate(meetings.size, contacted.size),
      conversionRate: rate(won.size, contacted.size),
      avgResponseHours: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      avgLeadScore: avgLead._avg.leadScore,
    },
    series,
    byCategory: Array.from(byCategory.entries()).map(([k, v]) => ({ category: k, ...v })).sort((a, b) => b.contacted - a.contacted),
    byCampaign,
    intents,
  };
}

export async function responseStats(workspaceId: string) {
  const [inbound, contacted, drafts, awaiting, review] = await Promise.all([
    db.emailMessage.groupBy({ by: ["intent"], where: { workspaceId, direction: "INBOUND" }, _count: true }),
    db.emailMessage.findMany({ where: { workspaceId, direction: "OUTBOUND", kind: "OUTREACH", status: "SENT" }, distinct: ["businessId"], select: { businessId: true } }),
    db.aiResponseDraft.count({ where: { workspaceId } }),
    db.aiResponseDraft.count({ where: { workspaceId, status: "PENDING" } }),
    db.conversation.count({ where: { workspaceId, needsHumanReview: true } }),
  ]);
  const by = (i: string) => inbound.find((g) => g.intent === i)?._count ?? 0;
  const total = inbound.reduce((s, g) => s + g._count, 0);
  const repliedBiz = await db.emailMessage.findMany({ where: { workspaceId, direction: "INBOUND", businessId: { in: contacted.map((c) => c.businessId!).filter(Boolean) } }, distinct: ["businessId"], select: { businessId: true } });
  return {
    total,
    responseRate: contacted.length ? repliedBiz.length / contacted.length : null,
    interested: by("INTERESTED") + by("PRICING"),
    notInterested: by("NOT_INTERESTED"),
    questions: by("QUESTION"),
    meetings: by("REQUEST_FOR_MEETING") + by("REQUEST_FOR_PHONE_CALL"),
    aiDrafts: drafts,
    awaitingApproval: awaiting,
    humanReview: review,
  };
}

export async function globalSearch(workspaceId: string, q: string) {
  const term = q.trim();
  if (term.length < 2) return { businesses: [], contacts: [], emails: [], campaigns: [], prompts: [], notes: [] };
  const ci = { contains: term, mode: "insensitive" as const };
  const [businesses, contacts, emails, campaigns, prompts, notes] = await Promise.all([
    db.business.findMany({ where: { workspaceId, OR: [{ name: ci }, { email: ci }, { website: ci }, { phone: { contains: term } }, { city: ci }] }, take: 8, select: { id: true, name: true, city: true, status: true } }),
    db.contact.findMany({ where: { workspaceId, OR: [{ name: ci }, { email: ci }] }, take: 5, select: { id: true, name: true, email: true, businessId: true, business: { select: { name: true } } } }),
    db.emailMessage.findMany({ where: { workspaceId, status: { not: "DRAFT" }, OR: [{ subject: ci }, { bodyText: ci }, { fromAddress: ci }, { toAddress: ci }] }, take: 6, orderBy: { createdAt: "desc" }, select: { id: true, subject: true, conversationId: true, direction: true, business: { select: { name: true } } } }),
    db.campaign.findMany({ where: { workspaceId, name: ci }, take: 5, select: { id: true, name: true, status: true } }),
    db.generatedPrompt.findMany({ where: { workspaceId, OR: [{ title: ci }, { business: { name: ci } }] }, take: 5, select: { id: true, title: true } }),
    db.note.findMany({ where: { workspaceId, body: ci }, take: 5, select: { id: true, body: true, businessId: true, business: { select: { name: true } } } }),
  ]);
  return { businesses, contacts, emails, campaigns, prompts, notes };
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Prevent CSV formula injection in spreadsheet apps.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportLeadsCsv(workspaceId: string, f: Partial<LeadFiltersT>, ids?: string[]) {
  const where = ids?.length ? { workspaceId, id: { in: ids } } : leadWhere(workspaceId, f);
  const rows = await db.business.findMany({
    where,
    orderBy: { discoveredAt: "desc" },
    take: 20000,
    select: {
      name: true, category: true, address: true, phone: true, website: true, email: true, websiteStatus: true, websiteScore: true, opportunityScore: true, status: true, lastResponseAt: true, lastContactedAt: true, discoveredAt: true,
      campaignLeads: { select: { campaign: { select: { name: true } } } },
    },
  });
  const header = ["Business", "Category", "Address", "Phone", "Website", "Email", "Website Status", "Website Score", "Opportunity Score", "Lead Status", "Response Status", "Campaign", "Date Added"];
  const lines = rows.map((r) =>
    [
      r.name, r.category, r.address, r.phone, r.website, r.email, r.websiteStatus, r.websiteScore, r.opportunityScore, r.status,
      r.lastResponseAt ? "Responded" : r.lastContactedAt ? "Awaiting reply" : "Not contacted",
      r.campaignLeads.map((c) => c.campaign.name).join("; "),
      r.discoveredAt.toISOString().slice(0, 10),
    ].map(csvCell).join(","),
  );
  return { csv: [header.join(","), ...lines].join("\r\n") + "\r\n", count: rows.length };
}
