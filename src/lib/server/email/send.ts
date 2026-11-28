import "../guard";
import type { EmailAccount, MessageKind } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { changeLeadStatus, isSuppressed } from "../leads";
import { getSettings } from "../workspace";
import { providerFor } from "./providers";
import { pickSendingAccount, restFor } from "./inboxes";

export type SendInput = {
  workspaceId: string;
  userId: string | null;
  to: string;
  subject: string;
  body: string;
  kind: MessageKind;
  businessId?: string | null;
  conversationId?: string | null;
  campaignId?: string | null;
  draftMessageId?: string | null;
  aiGenerated?: boolean;
  /** true for automated sends (follow-ups, auto replies) — stricter checks, no exceptions. */
  automated?: boolean;
};

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
const FREE_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "live.com", "msn.com", "proton.me", "protonmail.com"];

/** The inbox an email would go from right now (see inboxes.ts for how inboxes take turns). */
export async function getSendingAccount(workspaceId: string, opts: { kind?: MessageKind; conversationId?: string | null } = {}): Promise<EmailAccount> {
  const conv = opts.conversationId ? await db.conversation.findFirst({ where: { id: opts.conversationId, workspaceId }, select: { emailAccountId: true } }) : null;
  return pickSendingAccount(workspaceId, { kind: opts.kind ?? "OUTREACH", boundAccountId: conv?.emailAccountId });
}

/** Pre-flight checks shared by the UI (to show what would block a send) and the sender. */
export async function checkSendAllowed(input: Pick<SendInput, "workspaceId" | "to" | "businessId" | "kind" | "automated">) {
  const { compliance } = await getSettings(input.workspaceId);
  const to = input.to.trim().toLowerCase();
  if (!EMAIL_RE.test(to)) throw new AppError("VALIDATION", `“${input.to}” is not a valid email address.`);
  const suppressed = await isSuppressed(input.workspaceId, to);
  if (suppressed) throw new AppError("SUPPRESSED", `${to} is on the do-not-contact list (${suppressed.reason}). Nothing was sent.`);
  if (compliance.blockFreeEmailDomains && ["OUTREACH", "FOLLOW_UP"].includes(input.kind) && FREE_DOMAINS.includes(to.split("@")[1]!)) {
    throw new AppError("SUPPRESSED", "Workspace compliance settings block cold outreach to free personal email domains.");
  }
  if (["OUTREACH", "FOLLOW_UP"].includes(input.kind)) {
    // CASL: an address judged ineligible (no-solicitation notice, irrelevant role, withdrawn consent) never gets commercial email.
    const blocked = await db.contact.findFirst({ where: { workspaceId: input.workspaceId, email: to, eligibility: "INELIGIBLE" }, select: { eligibilityReason: true } });
    if (blocked) throw new AppError("SUPPRESSED", `${to} is not eligible for commercial email: ${blocked.eligibilityReason ?? "no valid consent basis"} Nothing was sent. If you have express consent, record it on the lead's Contacts tab.`);
  }
  if (input.businessId) {
    const b = await db.business.findFirst({ where: { id: input.businessId, workspaceId: input.workspaceId } });
    if (!b) throw new AppError("NOT_FOUND", "Lead not found.");
    if (b.doNotContact) throw new AppError("SUPPRESSED", `${b.name} is marked Do Not Contact. Nothing was sent.`);
    if (input.kind === "OUTREACH") {
      const prior = await db.emailMessage.findFirst({ where: { businessId: b.id, direction: "OUTBOUND", status: { in: ["SENT", "QUEUED"] }, kind: "OUTREACH" } });
      if (prior) throw new AppError("CONFLICT", `${b.name} has already received initial outreach. Use a follow-up or reply in the conversation instead.`);
    }
    if (["OUTREACH", "FOLLOW_UP"].includes(input.kind) && b.lastContactedAt && compliance.minDaysBetweenContacts > 0) {
      const days = (Date.now() - b.lastContactedAt.getTime()) / 86400_000;
      if (days < compliance.minDaysBetweenContacts) {
        throw new AppError("RATE_LIMITED", `${b.name} was contacted ${days < 1 ? "today" : `${Math.floor(days)} day(s) ago`}. Minimum gap is ${compliance.minDaysBetweenContacts} days.`);
      }
    }
    if (input.kind === "FOLLOW_UP") {
      const count = await db.emailMessage.count({ where: { businessId: b.id, kind: "FOLLOW_UP", status: { in: ["SENT", "QUEUED"] } } });
      if (count >= compliance.maxFollowUps) throw new AppError("RATE_LIMITED", `Maximum follow-ups (${compliance.maxFollowUps}) already sent to ${b.name}.`);
    }
  }
  return compliance;
}

function composeFinalBody(body: string, account: EmailAccount, compliance: Awaited<ReturnType<typeof getSettings>>["compliance"], kind: MessageKind, aiGenerated: boolean, unsubscribeLink?: string) {
  const parts = [body.trim()];
  if (account.signature.trim()) parts.push(account.signature.trim());
  const footer: string[] = [];
  if (aiGenerated && compliance.aiDisclosureEnabled && compliance.aiDisclosureText.trim()) footer.push(compliance.aiDisclosureText.trim());
  if (["OUTREACH", "FOLLOW_UP"].includes(kind)) {
    if (compliance.includeUnsubscribeFooter && compliance.unsubscribeText.trim()) footer.push(compliance.unsubscribeText.trim());
    // CASL: a working, one-step unsubscribe mechanism in every commercial message.
    if (compliance.includeUnsubscribeFooter && unsubscribeLink) footer.push(`Unsubscribe: ${unsubscribeLink}`);
    if (compliance.physicalAddress.trim()) footer.push(compliance.physicalAddress.trim());
  }
  if (footer.length) parts.push(`--\n${footer.join("\n")}`);
  return parts.join("\n\n");
}

/**
 * The only code path that sends email. Enforces suppression, do-not-contact,
 * per-workspace hourly/daily limits and minimum spacing (under an advisory
 * lock so concurrent sends can't exceed limits), threading, and persistence.
 */
export async function sendEmail(input: SendInput) {
  const compliance = await checkSendAllowed(input);
  if (!input.subject.trim()) throw new AppError("VALIDATION", "Subject is required.");
  if (!input.body.trim()) throw new AppError("VALIDATION", "Message body is required.");
  if (/\{\{\s*[a-z_]+\s*\}\}/.test(input.subject + input.body)) throw new AppError("VALIDATION", "The email still contains unfilled template variables ({{…}}). Edit them before sending.");
  const to = input.to.trim().toLowerCase();
  const { unsubscribeUrl } = await import("./unsubscribe");
  const unsubscribe = unsubscribeUrl(input.workspaceId, to);
  // Outreach drafted outside a campaign still belongs to the campaign the lead is in (most recently added).
  if (!input.campaignId && input.businessId && input.kind === "OUTREACH") {
    const member = await db.campaignLead.findFirst({ where: { businessId: input.businessId, campaign: { workspaceId: input.workspaceId } }, orderBy: { addedAt: "desc" }, select: { campaignId: true } });
    if (member) input = { ...input, campaignId: member.campaignId };
  }

  // Conversation + threading context
  let conversation = input.conversationId ? await db.conversation.findFirst({ where: { id: input.conversationId, workspaceId: input.workspaceId } }) : null;
  if (input.conversationId && !conversation) throw new AppError("NOT_FOUND", "Conversation not found.");
  if (!conversation && input.kind !== "OUTREACH" && input.businessId) {
    conversation = await db.conversation.findFirst({ where: { workspaceId: input.workspaceId, businessId: input.businessId, counterpartEmail: to }, orderBy: { lastMessageAt: "desc" } });
  }
  const thread = conversation
    ? await db.emailMessage.findMany({ where: { conversationId: conversation.id, status: { in: ["SENT", "RECEIVED"] } }, orderBy: { createdAt: "asc" }, select: { rfcMessageId: true, providerThreadId: true, emailAccountId: true } })
    : [];
  const refs = thread.map((t) => t.rfcMessageId).filter(Boolean) as string[];
  const inReplyTo = refs[refs.length - 1] ?? null;
  const startedFrom = conversation?.emailAccountId ?? null;
  const convThreadId = conversation?.providerThreadId ?? null;

  // Reserve a send slot atomically
  const { queued, account, finalBody } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`send:${input.workspaceId}`}))`;
    // Which inbox: the conversation's own, else the least-used one with room. Inside the lock, so two
    // sends can't both take an inbox's last slot for the day.
    const account = await pickSendingAccount(input.workspaceId, { kind: input.kind, boundAccountId: startedFrom, client: tx });
    const finalBody = composeFinalBody(input.body, account, compliance, input.kind, Boolean(input.aiGenerated), unsubscribe);
    const now = Date.now();
    const base = { workspaceId: input.workspaceId, direction: "OUTBOUND" as const, status: { in: ["SENT" as const, "QUEUED" as const] } };
    const [day, hour, last] = await Promise.all([
      tx.emailMessage.count({ where: { ...base, createdAt: { gte: new Date(now - 86400_000) } } }),
      tx.emailMessage.count({ where: { ...base, createdAt: { gte: new Date(now - 3600_000) } } }),
      tx.emailMessage.findFirst({ where: base, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    // 0 = no limit (the owner chose to send without a cap; the UI shows a caution instead).
    if (compliance.maxEmailsPerDay > 0 && day >= compliance.maxEmailsPerDay) throw new AppError("RATE_LIMITED", `Daily sending limit reached (${compliance.maxEmailsPerDay}/day). Nothing was sent.`);
    if (compliance.maxEmailsPerHour > 0 && hour >= compliance.maxEmailsPerHour) throw new AppError("RATE_LIMITED", `Hourly sending limit reached (${compliance.maxEmailsPerHour}/hour). Nothing was sent.`);
    if (last && compliance.minMinutesBetweenSends > 0) {
      const wait = compliance.minMinutesBetweenSends * 60_000 - (now - last.createdAt.getTime());
      if (wait > 0) throw new AppError("RATE_LIMITED", `Minimum delay between sends is ${compliance.minMinutesBetweenSends} min. Try again in ${Math.ceil(wait / 1000)}s.`, { retryAfter: Math.ceil(wait / 1000) });
    }
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: { workspaceId: input.workspaceId, businessId: input.businessId ?? null, emailAccountId: account.id, subject: input.subject, counterpartEmail: to, lastDirection: "OUTBOUND" },
      });
    } else if (conversation.emailAccountId !== account.id) {
      // The inbox it started in was disconnected: the conversation continues from this one from now on.
      conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { emailAccountId: account.id, providerThreadId: null } });
    }
    const msgData = {
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      businessId: input.businessId ?? conversation.businessId ?? null,
      emailAccountId: account.id,
      campaignId: input.campaignId ?? null,
      direction: "OUTBOUND" as const,
      status: "QUEUED" as const,
      kind: input.kind,
      fromAddress: account.emailAddress,
      toAddress: to,
      subject: input.subject,
      bodyText: finalBody,
      inReplyTo,
      references: refs.join(" ") || null,
      aiGenerated: Boolean(input.aiGenerated),
      sentById: input.userId,
    };
    if (input.draftMessageId) {
      const d = await tx.emailMessage.findFirst({ where: { id: input.draftMessageId, workspaceId: input.workspaceId, status: "DRAFT" } });
      if (!d) throw new AppError("CONFLICT", "This draft was already sent or deleted.");
      // createdAt marks when the send was queued: sending limits and spacing count from it.
      return { account, finalBody, queued: await tx.emailMessage.update({ where: { id: d.id }, data: { ...msgData, createdAt: new Date() } }) };
    }
    return { account, finalBody, queued: await tx.emailMessage.create({ data: msgData }) };
  });

  const conv = conversation!;
  // Gmail thread ids belong to one mailbox: only continue a thread the sending inbox itself holds.
  const providerThreadId = thread.filter((t) => t.emailAccountId === account.id).map((t) => t.providerThreadId).filter(Boolean).pop() ?? (startedFrom === account.id ? convThreadId : null);
  let replyToOverride: string | null = null;
  if (account.inboundAddress) {
    const [local, domain] = account.inboundAddress.split("@");
    replyToOverride = `${local}+${conv.id}@${domain}`;
  }

  try {
    const result = await providerFor(account).send({ to, subject: input.subject, text: finalBody, inReplyTo, references: refs.join(" ") || null, providerThreadId, replyToOverride });
    const sentAt = new Date();
    const message = await db.emailMessage.update({
      where: { id: queued.id },
      data: { status: "SENT", sentAt, providerMessageId: result.providerMessageId, rfcMessageId: result.rfcMessageId, providerThreadId: result.providerThreadId },
    });
    await db.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: sentAt, lastDirection: "OUTBOUND", providerThreadId: conv.providerThreadId ?? result.providerThreadId, needsHumanReview: false, reviewReason: null, unread: false },
    });
    // It sent, so the connection works: clear a stale error.
    if (account.status === "ERROR") await db.emailAccount.update({ where: { id: account.id }, data: { status: "CONNECTED", lastError: null } });
    if (message.businessId) {
      await db.business.update({ where: { id: message.businessId }, data: { lastContactedAt: sentAt } });
      if (input.kind === "OUTREACH") await changeLeadStatus({ workspaceId: input.workspaceId, businessId: message.businessId, to: "CONTACTED", userId: input.userId, automatic: true, reason: "Outreach sent" });
      if (input.kind === "FOLLOW_UP") await changeLeadStatus({ workspaceId: input.workspaceId, businessId: message.businessId, to: "FOLLOW_UP", userId: input.userId, automatic: true, reason: "Follow-up sent" });
    }
    await logActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      businessId: message.businessId,
      action: input.automated ? "email.auto_sent" : "email.sent",
      summary: `${labelForKind(input.kind)} sent to ${to}${input.automated ? " automatically" : ""}${account.provider === "SANDBOX" ? " (SANDBOX — not delivered)" : ""}`,
      details: { messageId: message.id, provider: account.provider },
    });
    if (input.kind === "OUTREACH" && message.businessId) {
      const { scheduleFollowUps } = await import("../followups");
      await scheduleFollowUps(input.workspaceId, message.businessId, conv.id, input.campaignId ?? null, sentAt);
    }
    return { message, conversationId: conv.id, sandbox: account.provider === "SANDBOX", from: account.emailAddress };
  } catch (e) {
    const reason = describeError(e);
    const code = (e as AppError).code;
    await db.emailMessage.update({ where: { id: queued.id }, data: { status: "FAILED", error: reason.slice(0, 1000) } });
    await notify({ workspaceId: input.workspaceId, type: "EMAIL_FAILURE", title: `Email to ${to} failed`, body: reason, link: input.businessId ? `/leads/${input.businessId}` : `/inbox/${conv.id}` });
    if (code === "INVALID_CREDENTIALS") await db.emailAccount.update({ where: { id: account.id }, data: { status: "ERROR", lastError: reason.slice(0, 500) } });
    // Gmail asked this inbox to slow down: it rests, and new outreach goes from the other inboxes meanwhile.
    if (code === "QUOTA_EXCEEDED" || code === "RATE_LIMITED") await db.emailAccount.update({ where: { id: account.id }, data: { restUntil: new Date(Date.now() + restFor(reason)) } });
    throw e;
  }
}

export const labelForKind = (k: MessageKind) => ({ OUTREACH: "Outreach email", FOLLOW_UP: "Follow-up", REPLY: "Reply", AI_REPLY: "AI-drafted reply", INBOUND: "Message" })[k];
