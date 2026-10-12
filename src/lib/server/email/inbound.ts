import "../guard";
import type { EmailAccount } from "@prisma/client";
import { db } from "../../db";
import { logActivity } from "../activity";
import { cancelFollowUps } from "../followups";
import { changeLeadStatus } from "../leads";
import type { InboundEmail } from "./providers";
import { providerFor } from "./providers";
import { assessRelevance, categorizeEmail, type Relevance } from "./relevance";
import { getAi } from "../ai/client";
import { getSettings } from "../workspace";

export type MatchMethod = "mailbox_hash" | "in_reply_to" | "references" | "provider_thread" | "sender_email" | "sender_domain" | "unmatched";

/**
 * Stores an inbound email, matching it to the right conversation and lead.
 * Matching order (most to least reliable): reply-to tracking hash, In-Reply-To,
 * References, provider thread id, sender email, sender domain.
 * Idempotent on providerMessageId.
 */
export async function ingestInbound(account: EmailAccount, msg: InboundEmail, opts: { analyze?: "inline" | "queue" } = {}) {
  const workspaceId = account.workspaceId;
  if (!msg.providerMessageId) throw new Error("Inbound message without provider id");
  const dup = await db.emailMessage.findFirst({ where: { workspaceId, providerMessageId: msg.providerMessageId } });
  if (dup) return { messageId: dup.id, conversationId: dup.conversationId, matchedBy: "duplicate" as const, duplicate: true };
  const from = msg.from.toLowerCase();
  if (from === account.emailAddress.toLowerCase()) return null;

  let conversationId: string | null = null;
  let matchedBy: MatchMethod = "unmatched";

  if (msg.mailboxHash) {
    const c = await db.conversation.findFirst({ where: { id: msg.mailboxHash, workspaceId } });
    if (c) [conversationId, matchedBy] = [c.id, "mailbox_hash"];
  }
  const ids = (s: string | null) => (s ?? "").match(/<[^>]+>/g) ?? [];
  if (!conversationId && msg.inReplyTo) {
    const m = await db.emailMessage.findFirst({ where: { workspaceId, rfcMessageId: { in: ids(msg.inReplyTo) } }, select: { conversationId: true } });
    if (m?.conversationId) [conversationId, matchedBy] = [m.conversationId, "in_reply_to"];
  }
  if (!conversationId && msg.references) {
    const refs = ids(msg.references).reverse();
    const m = await db.emailMessage.findFirst({ where: { workspaceId, rfcMessageId: { in: refs } }, orderBy: { createdAt: "desc" }, select: { conversationId: true } });
    if (m?.conversationId) [conversationId, matchedBy] = [m.conversationId, "references"];
  }
  if (!conversationId && msg.providerThreadId) {
    const c = await db.conversation.findFirst({ where: { workspaceId, providerThreadId: msg.providerThreadId } });
    if (c) [conversationId, matchedBy] = [c.id, "provider_thread"];
  }
  let businessId: string | null = null;
  if (!conversationId) {
    const c = await db.conversation.findFirst({ where: { workspaceId, counterpartEmail: from }, orderBy: { lastMessageAt: "desc" } });
    if (c) [conversationId, matchedBy] = [c.id, "sender_email"];
    else {
      const b =
        (await db.business.findFirst({ where: { workspaceId, email: from } })) ??
        (await db.contact.findFirst({ where: { workspaceId, email: from }, include: { business: true } }))?.business ??
        null;
      if (b) [businessId, matchedBy] = [b.id, "sender_email"];
      else {
        const domain = from.split("@")[1];
        const byDomain = domain ? await db.business.findFirst({ where: { workspaceId, websiteDomain: domain } }) : null;
        if (byDomain) [businessId, matchedBy] = [byDomain.id, "sender_domain"];
      }
    }
  }

  // Relevance: emails tied to our outreach or a known lead are always kept. A conversation
  // that was filtered stays filtered unless it contains an email we sent. Anything else is
  // checked (prior contact → rules → AI) so spam/newsletters don't reach the inbox.
  let conversation = conversationId ? await db.conversation.findUniqueOrThrow({ where: { id: conversationId } }) : null;
  let relevance: Relevance | null = null;
  if (conversation?.filtered) {
    const ours = await db.emailMessage.findFirst({ where: { conversationId: conversation.id, direction: "OUTBOUND" }, select: { id: true } });
    if (ours) conversation = await db.conversation.update({ where: { id: conversation.id }, data: { filtered: false, filterReason: null } });
    else relevance = { related: false, method: "rules", category: "previously_filtered", reason: conversation.filterReason ?? "Earlier email from this sender was filtered" };
  } else if (!conversation && !businessId) {
    const { company, automation } = await getSettings(workspaceId);
    const ai = automation.aiResponseAnalysis ? await getAi(workspaceId).catch(() => null) : null;
    relevance = await assessRelevance(workspaceId, msg, company, ai);
  }
  const isFiltered = relevance ? !relevance.related : false;

  if (!conversation) {
    conversation = businessId
      ? (await db.conversation.findFirst({ where: { workspaceId, businessId }, orderBy: { lastMessageAt: "desc" } })) ??
        (await db.conversation.create({ data: { workspaceId, businessId, emailAccountId: account.id, subject: msg.subject, counterpartEmail: from } }))
      : isFiltered
        ? await db.conversation.create({ data: { workspaceId, emailAccountId: account.id, subject: msg.subject, counterpartEmail: from, filtered: true, filterReason: relevance!.reason.slice(0, 300), isOpen: false, unread: false } })
        : await db.conversation.create({ data: { workspaceId, emailAccountId: account.id, subject: msg.subject, counterpartEmail: from, needsHumanReview: true, reviewReason: relevance ? `Not matched to a lead — ${relevance.reason}`.slice(0, 300) : "Sender could not be matched to a lead" } });
  }

  const stored = await db.emailMessage.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      businessId: conversation.businessId,
      emailAccountId: account.id,
      direction: "INBOUND",
      status: "RECEIVED",
      kind: "INBOUND",
      fromAddress: from,
      toAddress: msg.to.slice(0, 500),
      subject: msg.subject.slice(0, 500),
      bodyText: msg.text.slice(0, 100_000),
      bodyHtml: msg.html?.slice(0, 200_000) ?? null,
      providerMessageId: msg.providerMessageId,
      rfcMessageId: msg.rfcMessageId,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      providerThreadId: msg.providerThreadId,
      receivedAt: msg.receivedAt,
      analysis: { matchedBy, ...(relevance ? { relevance } : {}) },
    },
  });
  const category = categorizeEmail(msg, { linkedToLead: Boolean(conversation.businessId), relevance });
  if (isFiltered) {
    // Kept for the record (Inbox → Filtered) but no lead updates, AI analysis or notifications.
    await db.conversation.update({ where: { id: conversation.id }, data: { category, lastMessageAt: msg.receivedAt, lastDirection: "INBOUND", providerThreadId: conversation.providerThreadId ?? msg.providerThreadId } });
    return { messageId: stored.id, conversationId: conversation.id, matchedBy, duplicate: false, filtered: true as const };
  }
  await db.conversation.update({
    where: { id: conversation.id },
    data: { category, lastMessageAt: msg.receivedAt, lastDirection: "INBOUND", unread: true, isOpen: true, providerThreadId: conversation.providerThreadId ?? msg.providerThreadId },
  });
  if (conversation.businessId) {
    await cancelFollowUps(workspaceId, conversation.businessId, "Business replied");
    if (!msg.isAutoReply) await changeLeadStatus({ workspaceId, businessId: conversation.businessId, to: "RESPONDED", automatic: true, reason: "Reply received" });
    await logActivity({ workspaceId, businessId: conversation.businessId, action: "email.received", summary: `Reply received from ${from}`, details: { messageId: stored.id, matchedBy } });
  }

  if (opts.analyze === "inline") {
    const { analyzeInboundMessage } = await import("../replies/analyze");
    await analyzeInboundMessage(workspaceId, stored.id);
  } else {
    const { enqueueJob } = await import("../jobs/queue");
    await enqueueJob({ workspaceId, type: "INBOUND_ANALYSIS", label: `Analyse reply from ${from}`, payload: { messageId: stored.id } });
  }
  return { messageId: stored.id, conversationId: conversation.id, matchedBy, duplicate: false, filtered: false as const };
}

/** Polls a provider (Gmail) for new inbound messages. */
export async function syncAccount(account: EmailAccount) {
  const started = new Date();
  const msgs = await providerFor(account).fetchInbound();
  let ingested = 0;
  let filtered = 0;
  for (const m of msgs.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
    const r = await ingestInbound(account, m);
    if (r && !r.duplicate) r.filtered ? filtered++ : ingested++;
  }
  await db.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: started, status: "CONNECTED", lastError: null } });
  return { fetched: msgs.length, ingested, filtered, message: `${ingested} new email${ingested === 1 ? "" : "s"}${filtered ? `, ${filtered} filtered as not related` : ""}` };
}
