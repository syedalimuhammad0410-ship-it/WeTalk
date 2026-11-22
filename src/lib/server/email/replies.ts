import "../guard";
import type { Intent } from "@prisma/client";
import { db } from "../../db";
import { stripQuotedReply } from "./mime";

/** Plain-language buckets for the "who replied and about what" view. */
export const REPLY_GROUPS = {
  interested: { label: "Interested", intents: ["INTERESTED", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL"] },
  question: { label: "Asked a question", intents: ["QUESTION", "CONFUSED"] },
  pricing: { label: "Asked about price", intents: ["PRICING", "PAYMENT"] },
  not_interested: { label: "Not interested", intents: ["NOT_INTERESTED"] },
  unsubscribed: { label: "Unsubscribed / complaint", intents: ["UNSUBSCRIBE", "COMPLAINT", "LEGAL"] },
  other: { label: "Auto-reply / other", intents: ["AUTO_REPLY", "SPAM", "OTHER"] },
} as const satisfies Record<string, { label: string; intents: readonly Intent[] }>;
export type ReplyGroup = keyof typeof REPLY_GROUPS | "pending";

export function replyGroup(intent: Intent | null): ReplyGroup {
  if (!intent) return "pending";
  return (Object.keys(REPLY_GROUPS) as (keyof typeof REPLY_GROUPS)[]).find((k) => (REPLY_GROUPS[k].intents as readonly string[]).includes(intent)) ?? "other";
}

export const INTENT_LABEL: Record<Intent, string> = {
  INTERESTED: "Interested",
  QUESTION: "Has a question",
  PRICING: "Asked about price",
  REQUEST_FOR_MEETING: "Wants a meeting",
  REQUEST_FOR_PHONE_CALL: "Wants a call",
  NOT_INTERESTED: "Not interested",
  UNSUBSCRIBE: "Unsubscribed",
  CONFUSED: "Confused",
  COMPLAINT: "Complaint",
  LEGAL: "Legal",
  PAYMENT: "Payment",
  SPAM: "Spam",
  AUTO_REPLY: "Auto-reply",
  OTHER: "Other",
};

export type BusinessReply = {
  businessId: string;
  name: string;
  category: string | null;
  city: string | null;
  conversationId: string | null;
  from: string;
  subject: string;
  at: Date;
  intent: Intent | null;
  intentLabel: string;
  group: ReplyGroup;
  confidence: number | null;
  /** What they said, in one or two sentences (AI summary when available, otherwise their own words). */
  summary: string;
  nextStep: string | null;
  messages: number;
  hot: boolean;
  needsReview: boolean;
  youReplied: boolean;
};

/** Every business that emailed back (newest first), with what their latest reply was about. */
export async function emailReplies(workspaceId: string): Promise<BusinessReply[]> {
  const msgs = await db.emailMessage.findMany({
    where: { workspaceId, direction: "INBOUND", businessId: { not: null }, OR: [{ conversationId: null }, { conversation: { is: { filtered: false } } }] },
    orderBy: [{ receivedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 2000,
    select: {
      businessId: true, conversationId: true, subject: true, bodyText: true, intent: true, confidence: true, analysis: true, receivedAt: true, createdAt: true, fromAddress: true,
      business: { select: { name: true, category: true, city: true } },
      conversation: { select: { isHot: true, needsHumanReview: true, lastDirection: true } },
    },
  });
  const out = new Map<string, BusinessReply>();
  for (const m of msgs) {
    const prev = out.get(m.businessId!);
    if (prev) {
      prev.messages++;
      continue;
    }
    const a = (m.analysis ?? {}) as { summary?: string; recommended?: string };
    const own = stripQuotedReply(m.bodyText).replace(/\s+/g, " ").trim();
    out.set(m.businessId!, {
      businessId: m.businessId!,
      name: m.business?.name ?? m.fromAddress,
      category: m.business?.category ?? null,
      city: m.business?.city ?? null,
      conversationId: m.conversationId,
      from: m.fromAddress,
      subject: m.subject,
      at: m.receivedAt ?? m.createdAt,
      intent: m.intent,
      intentLabel: m.intent ? INTENT_LABEL[m.intent] : "Reading the reply…",
      group: replyGroup(m.intent),
      confidence: m.confidence,
      summary: a.summary?.trim() || (own.length > 220 ? `${own.slice(0, 217)}…` : own) || "(empty message)",
      nextStep: a.recommended?.trim() || null,
      messages: 1,
      hot: Boolean(m.conversation?.isHot),
      needsReview: Boolean(m.conversation?.needsHumanReview),
      youReplied: m.conversation?.lastDirection === "OUTBOUND",
    });
  }
  return [...out.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
}
