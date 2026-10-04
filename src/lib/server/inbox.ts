import "./guard";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import type { InboxSection } from "../constants";

export function sectionWhere(workspaceId: string, section: InboxSection): Prisma.ConversationWhereInput {
  const base = { workspaceId };
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
  const ids: InboxSection[] = ["all", "unread", "new", "draft", "interested", "followup", "review", "hot", "closed"];
  const counts = await Promise.all(ids.map((s) => db.conversation.count({ where: sectionWhere(workspaceId, s) })));
  return Object.fromEntries(ids.map((s, i) => [s, counts[i]!])) as Record<InboxSection, number>;
}
