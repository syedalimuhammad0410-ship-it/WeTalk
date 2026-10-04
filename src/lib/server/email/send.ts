import "../guard";
import type { EmailAccount, MessageKind } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { changeLeadStatus, isSuppressed } from "../leads";
import { getSettings } from "../workspace";
import { providerFor } from "./providers";

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

export async function getSendingAccount(workspaceId: string): Promise<EmailAccount> {
  const acc =
    (await db.emailAccount.findFirst({ where: { workspaceId, isDefault: true, status: { not: "DISCONNECTED" } } })) ??
    (await db.emailAccount.findFirst({ where: { workspaceId, status: { not: "DISCONNECTED" } } }));
  if (!acc) throw new AppError("NOT_CONFIGURED", "Connect an email account in Settings → Email to send emails.");
  return acc;
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

function composeFinalBody(body: string, account: EmailAccount, compliance: Awaited<ReturnType<typeof getSettings>>["compliance"], kind: MessageKind, aiGenerated: boolean) {
  const parts = [body.trim()];
  if (account.signature.trim()) parts.push(account.signature.trim());
  const footer: string[] = [];
  if (aiGenerated && compliance.aiDisclosureEnabled && compliance.aiDisclosureText.trim()) footer.push(compliance.aiDisclosureText.trim());
  if (["OUTREACH", "FOLLOW_UP"].includes(kind)) {
    if (compliance.includeUnsubscribeFooter && compliance.unsubscribeText.trim()) footer.push(compliance.unsubscribeText.trim());
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
  const account = await getSendingAccount(input.workspaceId);
  if (!input.subject.trim()) throw new AppError("VALIDATION", "Subject is required.");
  if (!input.body.trim()) throw new AppError("VALIDATION", "Message body is required.");
  if (/\{\{\s*[a-z_]+\s*\}\}/.test(input.subject + input.body)) throw new AppError("VALIDATION", "The email still contains unfilled template variables ({{…}}). Edit them before sending.");
  const to = input.to.trim().toLowerCase();
  const finalBody = composeFinalBody(input.body, account, compliance, input.kind, Boolean(input.aiGenerated));

  // Conversation + threading context
  let conversation = input.conversationId ? await db.conversation.findFirst({ where: { id: input.conversationId, workspaceId: input.workspaceId } }) : null;
  if (input.conversationId && !conversation) throw new AppError("NOT_FOUND", "Conversation not found.");
  if (!conversation && input.kind !== "OUTREACH" && input.businessId) {
    conversation = await db.conversation.findFirst({ where: { workspaceId: input.workspaceId, businessId: input.businessId, counterpartEmail: to }, orderBy: { lastMessageAt: "desc" } });
  }
  const thread = conversation
    ? await db.emailMessage.findMany({ where: { conversationId: conversation.id, status: { in: ["SENT", "RECEIVED"] } }, orderBy: { createdAt: "asc" }, select: { rfcMessageId: true, providerThreadId: true } })
    : [];
  const refs = thread.map((t) => t.rfcMessageId).filter(Boolean) as string[];
  const inReplyTo = refs[refs.length - 1] ?? null;
  const providerThreadId = thread.map((t) => t.providerThreadId).filter(Boolean).pop() ?? conversation?.providerThreadId ?? null;

  // Reserve a send slot atomically
  const queued = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`send:${input.workspaceId}`}))`;
    const now = Date.now();
    const base = { workspaceId: input.workspaceId, direction: "OUTBOUND" as const, status: { in: ["SENT" as const, "QUEUED" as const] } };
    const [day, hour, last] = await Promise.all([
      tx.emailMessage.count({ where: { ...base, createdAt: { gte: new Date(now - 86400_000) } } }),
      tx.emailMessage.count({ where: { ...base, createdAt: { gte: new Date(now - 3600_000) } } }),
      tx.emailMessage.findFirst({ where: base, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    if (day >= compliance.maxEmailsPerDay) throw new AppError("RATE_LIMITED", `Daily sending limit reached (${compliance.maxEmailsPerDay}/day). Nothing was sent.`);
    if (hour >= compliance.maxEmailsPerHour) throw new AppError("RATE_LIMITED", `Hourly sending limit reached (${compliance.maxEmailsPerHour}/hour). Nothing was sent.`);
    if (last && compliance.minMinutesBetweenSends > 0) {
      const wait = compliance.minMinutesBetweenSends * 60_000 - (now - last.createdAt.getTime());
      if (wait > 0) throw new AppError("RATE_LIMITED", `Minimum delay between sends is ${compliance.minMinutesBetweenSends} min. Try again in ${Math.ceil(wait / 1000)}s.`, { retryAfter: Math.ceil(wait / 1000) });
    }
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: { workspaceId: input.workspaceId, businessId: input.businessId ?? null, emailAccountId: account.id, subject: input.subject, counterpartEmail: to, lastDirection: "OUTBOUND" },
      });
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
      return tx.emailMessage.update({ where: { id: d.id }, data: msgData });
    }
    return tx.emailMessage.create({ data: msgData });
  });

  const conv = conversation!;
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
    return { message, conversationId: conv.id, sandbox: account.provider === "SANDBOX" };
  } catch (e) {
    const reason = describeError(e);
    await db.emailMessage.update({ where: { id: queued.id }, data: { status: "FAILED", error: reason.slice(0, 1000) } });
    await notify({ workspaceId: input.workspaceId, type: "EMAIL_FAILURE", title: `Email to ${to} failed`, body: reason, link: input.businessId ? `/leads/${input.businessId}` : `/inbox/${conv.id}` });
    if ((e as AppError).code === "INVALID_CREDENTIALS") await db.emailAccount.update({ where: { id: account.id }, data: { status: "ERROR", lastError: reason.slice(0, 500) } });
    throw e;
  }
}

export const labelForKind = (k: MessageKind) => ({ OUTREACH: "Outreach email", FOLLOW_UP: "Follow-up", REPLY: "Reply", AI_REPLY: "AI-drafted reply", INBOUND: "Message" })[k];
