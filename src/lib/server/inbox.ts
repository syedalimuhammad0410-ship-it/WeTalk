import "./guard";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { EMAIL_CATEGORIES, INTENT_META, type InboxSection } from "../constants";

export function sectionWhere(workspaceId: string, section: InboxSection): Prisma.ConversationWhereInput {
  // Emails judged unrelated to the agency (spam, newsletters, notifications) only appear under "Filtered".
  if (section === "filtered") return { workspaceId, filtered: true };
  const base = { workspaceId, filtered: false };
  switch (section) {
    case "unread": return { ...base, unread: true };
    case "new": return { ...base, lastDirection: "INBOUND", isOpen: true };
    case "draft": return { ...base, drafts: { some: { status: "PENDING" } } };
    case "interested": return { ...base, lastIntent: { in: ["INTERESTED", "PRICING", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL"] } };
    case "followup": return { ...base, business: { followUps: { some: { status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } } } } };
    case "review": return { ...base, needsHumanReview: true };
    case "hot": return { ...base, isHot: true, isOpen: true };
    case "closed": return { ...base, isOpen: false };
    default: return base;
  }
}

export async function sectionCounts(workspaceId: string) {
  const ids: InboxSection[] = ["all", "unread", "new", "draft", "interested", "followup", "review", "hot", "closed", "filtered"];
  const counts = await Promise.all(ids.map((s) => db.conversation.count({ where: sectionWhere(workspaceId, s) })));
  return Object.fromEntries(ids.map((s, i) => [s, counts[i]!])) as Record<InboxSection, number>;
}

export type InboxFilters = { cat?: string; contacted?: boolean; link?: "lead" | "unlinked"; intent?: string; days?: number; q?: string };

/** Reads inbox filters from URL search params (unknown values are ignored). */
export function parseInboxFilters(sp: Record<string, string | undefined>): InboxFilters {
  const f: InboxFilters = {};
  if (sp.cat && EMAIL_CATEGORIES.some((c) => c.id === sp.cat)) f.cat = sp.cat;
  if (sp.contacted === "1") f.contacted = true;
  if (sp.link === "lead" || sp.link === "unlinked") f.link = sp.link;
  if (sp.intent && sp.intent in INTENT_META) f.intent = sp.intent;
  const days = Number(sp.days);
  if ([1, 7, 30, 90].includes(days)) f.days = days;
  if (sp.q?.trim()) f.q = sp.q.trim().slice(0, 100);
  return f;
}

export function hasInboxFilters(f: InboxFilters) {
  return Boolean(f.cat || f.contacted || f.link || f.intent || f.days || f.q);
}

/**
 * Section + filters. Choosing an email type or "people we contacted" searches
 * filtered (not-related) email too, so e.g. verification codes can be found.
 */
export function inboxWhere(workspaceId: string, section: InboxSection, f: InboxFilters): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = { ...sectionWhere(workspaceId, section) };
  if ((f.cat || f.contacted) && section !== "filtered") delete where.filtered;
  const and: Prisma.ConversationWhereInput[] = [];
  if (f.cat) and.push({ category: f.cat });
  if (f.contacted) and.push({ messages: { some: { direction: "OUTBOUND" } } });
  if (f.link === "lead") and.push({ businessId: { not: null } });
  if (f.link === "unlinked") and.push({ businessId: null });
  if (f.intent) and.push({ lastIntent: f.intent as Prisma.ConversationWhereInput["lastIntent"] });
  if (f.days) and.push({ lastMessageAt: { gte: new Date(Date.now() - f.days * 86_400_000) } });
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    and.push({ OR: [{ subject: contains }, { counterpartEmail: contains }, { business: { name: contains } }, { messages: { some: { bodyText: contains } } }] });
  }
  return and.length ? { AND: [where, ...and] } : where;
}

/** Number of conversations per email type (including filtered ones), for the filter chips. */
export async function categoryCounts(workspaceId: string) {
  const rows = await db.conversation.groupBy({ by: ["category"], where: { workspaceId, category: { not: null } }, _count: { _all: true } });
  const contacted = await db.conversation.count({ where: { workspaceId, messages: { some: { direction: "OUTBOUND" } } } });
  return { byCategory: Object.fromEntries(rows.map((r) => [r.category!, r._count._all])) as Record<string, number>, contacted };
}
