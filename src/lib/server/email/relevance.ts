import "../guard";
import * as z from "zod";
import type { CompanyProfile } from "@prisma/client";
import { db } from "../../db";
import { describeError } from "../errors";
import type { AiProvider } from "../ai/client";
import type { EmailCategory } from "../../constants";

/**
 * Decides whether an inbound email that could NOT be matched to a lead or
 * conversation is relevant to the agency (a reply, an enquiry, a client) or
 * noise (newsletters, promotions, notifications, cold pitches, spam).
 *
 * Order: prior contact with the sender → rule signals → AI (Gemini/Claude)
 * for anything ambiguous. When in doubt the email is KEPT, so a real lead is
 * never hidden.
 */
export type RelevanceInput = {
  from: string;
  fromName?: string | null;
  subject: string;
  text: string;
  isBulk?: boolean;
  isAutoReply?: boolean;
  category?: string | null;
};
export type Relevance = { related: boolean; method: "prior_contact" | "rules" | "ai" | "default"; category: string; reason: string; confidence?: number };

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.ca", "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "rogers.com", "bell.net", "sympatico.ca", "shaw.ca", "telus.net"]);
const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|marketing|digest|automated|announcements?)([+._-].*)?@/i;
const JUNK_CONTENT = /\b(receipt|order (?:#|no\.?|number|confirmation|confirmed)|invoice #|your (?:order|receipt|statement|subscription|account statement)|verification code|verify your (?:email|account)|security alert|password reset|reset your password|new sign-?in|sign-?in attempt|one-time (?:code|passcode)|has shipped|out for delivery|payment received|\d{1,2}% off|sale ends|limited[- ]time offer|webinar|unsubscribe from|view (?:this email )?in (?:your )?browser)\b/i;
const AGENCY_TOPIC = /\b(website|web ?site|web design|redesign|landing page|seo|search engine|google (?:business|maps)|online booking|booking system|domain|hosting|quote|estimate|your (?:email|message|note)|you (?:reached out|contacted|emailed)|reaching out|interested)\b/i;

export const RelevanceSchema = z.object({
  related: z.boolean().describe("true if the email is relevant to the agency's work (reply from a contacted business, enquiry about website/SEO/booking work, existing client or vendor about agency work)"),
  category: z.enum(["business_reply", "new_enquiry", "client_or_vendor", "cold_pitch_to_us", "newsletter_or_promo", "notification_or_receipt", "personal", "phishing_or_scam", "other"]),
  confidence: z.number().int().min(0).max(100),
  reason: z.string().describe("One short sentence citing the text clues used"),
});

const CATEGORY_RULES: [EmailCategory, RegExp][] = [
  ["verification_code", /\b(verification code|security code|one-time (?:code|passcode|password)|\botp\b|2fa|two-factor|login code|sign-?in code|your code is|is your (?:verification |security |login )?code|confirmation code)\b/i],
  ["security_alert", /\b(password reset|reset your password|new sign-?in|sign-?in attempt|security alert|suspicious (?:activity|sign-?in|login)|unusual (?:activity|sign-?in)|new device|account (?:locked|compromised))\b/i],
  ["confirmation", /\b(confirm your (?:email|e-mail|account|subscription|registration|address)|please confirm|verify your (?:email|e-mail|account|address)|activate your account|email confirmation|thanks for (?:signing up|registering|subscribing)|welcome to\b|(?:booking|appointment|reservation|registration) (?:is )?confirm(?:ed|ation))\b/i],
  ["receipt_order", /\b(receipt|invoice (?:#|no\.?|number)|order (?:#|no\.?|number|confirmation|confirmed|update)|your order|has shipped|out for delivery|delivered|payment (?:received|confirmation|successful)|subscription (?:renewed|renewal))\b/i],
];

/** Picks the inbox-filter category for an email. Lead-linked conversations are "lead_reply". */
export function categorizeEmail(msg: RelevanceInput, opts: { linkedToLead?: boolean; relevance?: Relevance | null } = {}): EmailCategory {
  const hay = `${msg.subject}\n${msg.text.slice(0, 4000)}`;
  if (opts.linkedToLead) return "lead_reply";
  for (const [cat, re] of CATEGORY_RULES) if (re.test(hay)) return cat;
  if (msg.isBulk || /\b(newsletter|unsubscribe|\d{1,2}% off|sale ends|limited[- ]time offer|webinar)\b/i.test(hay)) return "newsletter_promo";
  if (AUTOMATED_SENDER.test(msg.from) || msg.category === "CATEGORY_UPDATES") return "notification";
  const r = opts.relevance;
  if (r) {
    const map: Record<string, EmailCategory> = {
      business_reply: "lead_reply", mentions_agency: "enquiry", new_enquiry: "enquiry", client_or_vendor: "enquiry", cold_pitch_to_us: "cold_pitch",
      newsletter_or_promo: "newsletter_promo", notification_or_receipt: "notification", personal: "personal", phishing_or_scam: "spam",
    };
    if (map[r.category]) return map[r.category]!;
    if (r.method === "prior_contact") return "lead_reply";
  }
  return "other";
}

export async function priorContact(workspaceId: string, from: string): Promise<string | null> {
  const email = from.toLowerCase();
  const sent = await db.emailMessage.findFirst({ where: { workspaceId, direction: "OUTBOUND", status: "SENT", toAddress: { contains: email, mode: "insensitive" } }, select: { id: true } });
  if (sent) return "We have emailed this address before";
  const domain = email.split("@")[1];
  if (domain && !FREE_MAIL.has(domain)) {
    const byDomain = await db.emailMessage.findFirst({ where: { workspaceId, direction: "OUTBOUND", status: "SENT", toAddress: { endsWith: `@${domain}`, mode: "insensitive" } }, select: { id: true } });
    if (byDomain) return `We have emailed someone at ${domain} before`;
  }
  return null;
}

/** Rule signals only; returns a decision when the signals are clear, otherwise null. */
export function ruleRelevance(msg: RelevanceInput, company: Pick<CompanyProfile, "companyName" | "senderName">): Relevance | null {
  const hay = `${msg.subject}\n${msg.text.slice(0, 4000)}`;
  const names = [company.companyName, company.senderName].map((n) => n.trim()).filter((n) => n.length >= 4);
  const mentionsUs = names.some((n) => hay.toLowerCase().includes(n.toLowerCase()));
  const automatedSender = AUTOMATED_SENDER.test(msg.from);
  const junk = JUNK_CONTENT.test(hay);
  const topic = AGENCY_TOPIC.test(hay);
  const isReply = /^\s*(re|aw|sv)\s*:/i.test(msg.subject);

  if (mentionsUs && !msg.isBulk && !automatedSender) return { related: true, method: "rules", category: "mentions_agency", reason: "Mentions your company or name" };
  if (msg.isBulk || automatedSender) return { related: false, method: "rules", category: msg.isBulk ? "newsletter_or_promo" : "notification_or_receipt", reason: msg.isBulk ? "Mailing-list / newsletter email (has unsubscribe headers)" : `Automated sender (${msg.from})` };
  if (junk && !isReply) return { related: false, method: "rules", category: "notification_or_receipt", reason: "Looks like a receipt, notification, security code or promotion" };
  if (isReply && topic && !junk) return { related: true, method: "rules", category: "business_reply", reason: "A reply about website-related work" };
  return null;
}

export async function assessRelevance(workspaceId: string, msg: RelevanceInput, company: CompanyProfile, ai: AiProvider | null): Promise<Relevance> {
  const prior = await priorContact(workspaceId, msg.from);
  if (prior) return { related: true, method: "prior_contact", category: "business_reply", reason: prior };
  const byRules = ruleRelevance(msg, company);
  if (byRules) return byRules;
  if (ai) {
    try {
      const r = await ai.json({
        feature: "inbound_relevance",
        system: `You triage the inbox of ${company.companyName || "a small web design agency"}${company.senderName ? ` (run by ${company.senderName})` : ""}, which builds and manages websites for local businesses.
Decide whether this email is RELEVANT to the agency's work:
- RELEVANT: a reply from a business the agency contacted; a new enquiry about a website, redesign, SEO, online booking, hosting or similar; an existing client or a vendor writing about agency work.
- NOT RELEVANT: newsletters, promotions, ads; cold sales pitches TO the agency (lead lists, SEO/marketing services, outsourcing offers); receipts, notifications, verification codes, account alerts; personal or unrelated email; phishing or scams.
Base the decision on concrete text clues (who it is from, what they ask, whether it refers to an earlier email, whether it is mass-produced). If genuinely unsure, set related to true with a low confidence.`,
        prompt: `AGENCY SERVICES: ${company.services.join(", ") || "website design"}\nSERVICE AREA: ${company.serviceAreas || company.location || "(not specified)"}\n\nEMAIL\nFrom: ${msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from}\nSubject: ${msg.subject}\n${msg.category ? `Gmail category: ${msg.category}\n` : ""}Body (first 3000 characters):\n${msg.text.slice(0, 3000)}`,
        schema: RelevanceSchema,
        maxTokens: 1500,
      });
      // Only hide an email when the AI is fairly sure it is unrelated.
      const related = r.related || r.confidence < 60;
      return { related, method: "ai", category: r.category, reason: r.reason, confidence: r.confidence };
    } catch (e) {
      return { related: true, method: "default", category: "other", reason: `AI check unavailable (${describeError(e)}); kept for review` };
    }
  }
  if (msg.category === "CATEGORY_UPDATES") return { related: false, method: "rules", category: "notification_or_receipt", reason: "Gmail filed it under Updates and nothing links it to your outreach" };
  return { related: true, method: "default", category: "other", reason: "Could not be matched to a lead; kept for review (connect an AI provider for automatic filtering)" };
}

/**
 * Re-checks existing inbox conversations that are not linked to a lead and
 * contain nothing we sent, and files the unrelated ones under "Filtered".
 */
export async function cleanupInbox(workspaceId: string, onProgress?: (p: { total: number; processed: number; message: string }) => Promise<void>) {
  const { getSettings } = await import("../workspace");
  const { getAi } = await import("../ai/client");
  const { company, automation } = await getSettings(workspaceId);
  const ai = automation.aiResponseAnalysis ? await getAi(workspaceId).catch(() => null) : null;
  const candidates = await db.conversation.findMany({
    // Conversations a team member moved back to the inbox are never re-filtered.
    where: { workspaceId, filtered: false, businessId: null, messages: { none: { direction: "OUTBOUND" } }, OR: [{ filterReason: null }, { NOT: { filterReason: { startsWith: "Kept in the inbox" } } }] },
    orderBy: { lastMessageAt: "desc" },
    take: 500,
    select: { id: true, counterpartEmail: true, messages: { where: { direction: "INBOUND" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, subject: true, bodyText: true, analysis: true } } },
  });
  let filtered = 0;
  for (const [i, c] of candidates.entries()) {
    const m = c.messages[0];
    if (m) {
      const input = { from: c.counterpartEmail, subject: m.subject, text: m.bodyText };
      const r = await assessRelevance(workspaceId, input, company, ai);
      const category = categorizeEmail(input, { relevance: r });
      if (r.related) await db.conversation.update({ where: { id: c.id }, data: { category } });
      else {
        await db.conversation.update({ where: { id: c.id }, data: { category, filtered: true, filterReason: r.reason.slice(0, 300), isOpen: false, unread: false, needsHumanReview: false } });
        await db.aiResponseDraft.updateMany({ where: { conversationId: c.id, status: "PENDING" }, data: { status: "SUPERSEDED" } });
        await db.emailMessage.update({ where: { id: m.id }, data: { analysis: { ...((m.analysis as object) ?? {}), relevance: r } } });
        filtered++;
      }
    }
    await onProgress?.({ total: candidates.length, processed: i + 1, message: `Checked ${i + 1} of ${candidates.length} · ${filtered} filtered` });
  }
  // Give every other conversation a category for the inbox filters (rules only, no AI cost).
  const uncategorised = await db.conversation.findMany({
    where: { workspaceId, category: null, messages: { some: { direction: "INBOUND" } } },
    take: 2000,
    select: { id: true, businessId: true, counterpartEmail: true, messages: { where: { direction: "INBOUND" }, orderBy: { createdAt: "desc" }, take: 1, select: { subject: true, bodyText: true } } },
  });
  for (const c of uncategorised) {
    const m = c.messages[0];
    if (m) await db.conversation.update({ where: { id: c.id }, data: { category: categorizeEmail({ from: c.counterpartEmail, subject: m.subject, text: m.bodyText }, { linkedToLead: Boolean(c.businessId) }) } });
  }
  return { checked: candidates.length, filtered, categorised: uncategorised.length, message: `Checked ${candidates.length} unmatched conversation${candidates.length === 1 ? "" : "s"}; ${filtered} moved to Filtered; ${uncategorised.length} sorted into categories.` };
}
