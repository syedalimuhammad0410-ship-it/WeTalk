import "../guard";
import * as z from "zod";
import type { Intent, Prisma } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { getAi } from "../ai/client";
import { changeLeadStatus } from "../leads";
import { getSettings } from "../workspace";
import { stripQuotedReply } from "../email/mime";
import { scanCommitments } from "../email/safety";
import { evaluateAutoSend } from "./policy";
import { ruleClassify } from "./rules";

const INTENTS = ["INTERESTED", "QUESTION", "PRICING", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL", "NOT_INTERESTED", "UNSUBSCRIBE", "CONFUSED", "COMPLAINT", "LEGAL", "PAYMENT", "SPAM", "AUTO_REPLY", "OTHER"] as const;

const AnalysisSchema = z.object({
  intent: z.enum(INTENTS),
  secondary_intents: z.array(z.enum(INTENTS)),
  confidence: z.number().describe("0-100: how confident you are in the intent"),
  lead_score: z.number().describe("0-100: how likely this becomes a customer"),
  summary: z.string(),
  context_resolution: z.string().describe("What references like 'Tuesday', 'that', 'the ideas' point to in earlier messages, or empty"),
  questions_asked: z.array(z.string()),
  recommended_action: z.string(),
  response_needed: z.boolean(),
  requires_human_review: z.boolean(),
  review_reason: z.string(),
});

const DraftSchema = z.object({
  body: z.string(),
  missing_info: z.array(z.string()).describe("Information the reply needed but that is not configured (e.g. pricing, availability)"),
  requires_human_review: z.boolean(),
  review_reason: z.string(),
});

type ThreadMsg = { direction: string; fromAddress: string; bodyText: string; createdAt: Date; subject: string };

function renderThread(thread: ThreadMsg[]) {
  return thread
    .map((m, i) => `[#${i + 1} ${m.direction === "OUTBOUND" ? "US" : "THEM"} — ${m.createdAt.toISOString().slice(0, 16).replace("T", " ")}]\nSubject: ${m.subject}\n${(m.direction === "INBOUND" ? stripQuotedReply(m.bodyText) : m.bodyText.split(/\n--\n/)[0]!).slice(0, 4000)}`)
    .join("\n\n");
}

/**
 * Analyses an inbound message in the context of its whole conversation,
 * applies do-not-contact rules, updates the lead, drafts a reply when
 * appropriate and decides (default-deny) whether it may be auto-sent.
 */
export async function analyzeInboundMessage(workspaceId: string, messageId: string) {
  const message = await db.emailMessage.findFirst({ where: { id: messageId, workspaceId, direction: "INBOUND" }, include: { conversation: true } });
  if (!message || !message.conversation) throw new AppError("NOT_FOUND", "Inbound message not found.");
  const conv = message.conversation;
  const business = conv.businessId ? await db.business.findUnique({ where: { id: conv.businessId } }) : null;
  const { automation, company } = await getSettings(workspaceId);
  const thread = await db.emailMessage.findMany({ where: { conversationId: conv.id, status: { in: ["SENT", "RECEIVED"] }, createdAt: { lte: message.createdAt } }, orderBy: { createdAt: "asc" } });
  const newText = stripQuotedReply(message.bodyText);
  const rules = ruleClassify(newText, message.subject);
  const notes: string[] = [];

  // ── Unsubscribe: act immediately, no AI needed ──
  if (rules.unsubscribe) {
    if (business && !business.doNotContact) {
      await changeLeadStatus({ workspaceId, businessId: business.id, to: "DO_NOT_CONTACT", reason: `Unsubscribe request received ${new Date().toISOString().slice(0, 10)}` });
    }
    await db.suppressionEntry.upsert({
      where: { workspaceId_value: { workspaceId, value: message.fromAddress.toLowerCase() } },
      create: { workspaceId, value: message.fromAddress.toLowerCase(), reason: "Unsubscribe request" },
      update: {},
    });
    await db.followUp.updateMany({ where: { workspaceId, conversationId: conv.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED", cancelReason: "Unsubscribe request" } });
    await db.aiResponseDraft.updateMany({ where: { conversationId: conv.id, status: "PENDING" }, data: { status: "SUPERSEDED" } });
    await db.emailMessage.update({ where: { id: message.id }, data: { intent: "UNSUBSCRIBE", confidence: 95, analysis: { rules: rules as unknown as Prisma.InputJsonValue, summary: "Unsubscribe / do-not-contact request — suppressed automatically." } } });
    await db.conversation.update({ where: { id: conv.id }, data: { lastIntent: "UNSUBSCRIBE", lastConfidence: 95, needsHumanReview: false, reviewReason: "Unsubscribe processed: lead set to Do Not Contact and all automation stopped.", isHot: false } });
    await notify({ workspaceId, type: "NEW_RESPONSE", title: `${business?.name ?? message.fromAddress} unsubscribed`, body: "Marked Do Not Contact. Follow-ups and AI replies stopped.", link: `/inbox/${conv.id}` });
    return { intent: "UNSUBSCRIBE" as Intent, confidence: 95, draftId: null, autoSent: false, reviewReasons: [] as string[] };
  }

  // ── Classification ──
  let intent: Intent = rules.primary;
  let secondary: Intent[] = rules.intents.filter((x) => x !== intent);
  let confidence = rules.confidence;
  let leadScore: number | null = null;
  let aiRequestedReview = false;
  let aiReviewReason = "";
  let summary = "";
  let recommended = defaultAction(intent);
  let contextResolution = "";
  let responseNeeded = !["SPAM", "AUTO_REPLY", "NOT_INTERESTED"].includes(intent);
  const ai = automation.aiResponseAnalysis ? await getAi(workspaceId) : null;
  if (!ai) notes.push(automation.aiResponseAnalysis ? "AI analysis unavailable (connect Anthropic) — rule-based classification only." : "AI response analysis is disabled.");
  if (ai) {
    try {
      const a = await ai.json({
        feature: "reply_analysis",
        system: "You analyse replies to a web agency's outreach emails. Read the ENTIRE conversation to resolve references (e.g. 'Tuesday works' refers to a time proposed earlier). Classify the LATEST message from THEM. Be conservative: if the message involves legal matters, complaints, payments, contracts, sensitive information, security, hostility, or anything ambiguous, set requires_human_review=true and explain why. Confidence must reflect genuine certainty.",
        prompt: `Our company: ${company.companyName || "(not set)"} — ${company.description}\nBusiness we contacted: ${business?.name ?? "(unmatched sender)"}\n\nCONVERSATION (oldest first):\n${renderThread(thread)}\n\nClassify the latest message (#${thread.length}).`,
        schema: AnalysisSchema,
        maxTokens: 3000,
      });
      const SAFETY_FIRST: Intent[] = ["LEGAL", "COMPLAINT", "PAYMENT", "SPAM", "AUTO_REPLY"];
      intent = SAFETY_FIRST.includes(rules.primary) ? rules.primary : (a.intent as Intent);
      secondary = Array.from(new Set([...(a.secondary_intents as Intent[]), ...rules.intents])).filter((x) => x !== intent);
      confidence = Math.max(0, Math.min(100, Math.round(a.confidence)));
      if (SAFETY_FIRST.includes(rules.primary) && a.intent !== rules.primary) confidence = Math.min(confidence, 60);
      leadScore = Math.max(0, Math.min(100, Math.round(a.lead_score)));
      aiRequestedReview = a.requires_human_review;
      aiReviewReason = a.review_reason;
      summary = a.summary;
      recommended = a.recommended_action || recommended;
      contextResolution = a.context_resolution;
      responseNeeded = a.response_needed;
    } catch (e) {
      notes.push(`AI analysis failed: ${describeError(e)} — used rule-based classification.`);
      confidence = Math.min(confidence, 60);
    }
  }
  if (leadScore == null) leadScore = { INTERESTED: 75, REQUEST_FOR_MEETING: 85, REQUEST_FOR_PHONE_CALL: 80, PRICING: 70, QUESTION: 55, CONFUSED: 30, NOT_INTERESTED: 5, OTHER: 30 }[intent as string] ?? 20;

  const sensitiveFlags = rules.sensitive.map((s) => s.flag);
  const isHot = ["INTERESTED", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL", "PRICING"].includes(intent) && confidence >= 70;
  await db.emailMessage.update({
    where: { id: message.id },
    data: {
      intent,
      confidence,
      analysis: { summary, recommended, contextResolution, secondary, sensitive: rules.sensitive, notes, responseNeeded, aiRequestedReview, aiReviewReason } as Prisma.InputJsonValue,
    },
  });

  // ── Lead updates ──
  if (business) {
    await db.business.update({ where: { id: business.id }, data: { lastIntent: intent, leadScore, lastResponseAt: message.receivedAt ?? new Date() } });
    if (["INTERESTED", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL", "PRICING"].includes(intent) && confidence >= 60) {
      await changeLeadStatus({ workspaceId, businessId: business.id, to: "INTERESTED", automatic: true, reason: `Reply classified as ${intent.replace(/_/g, " ").toLowerCase()}` });
    }
  }
  if (isHot) await notify({ workspaceId, type: "HOT_LEAD", title: `Hot lead: ${business?.name ?? message.fromAddress}`, body: summary || newText.slice(0, 140), link: `/inbox/${conv.id}` });
  if (intent === "REQUEST_FOR_MEETING" || intent === "REQUEST_FOR_PHONE_CALL") await notify({ workspaceId, type: "MEETING_REQUESTED", title: `${business?.name ?? message.fromAddress} wants to ${intent === "REQUEST_FOR_MEETING" ? "meet" : "talk by phone"}`, body: contextResolution || newText.slice(0, 140), link: `/inbox/${conv.id}` });

  // ── Draft ──
  const blockedForDraft =
    automation.responseMode === "MANUAL" ? "Manual mode: AI does not draft replies" :
    !automation.aiResponseDrafting ? "AI response drafting is disabled" :
    !ai ? "Connect Anthropic to enable AI drafts" :
    ["SPAM", "AUTO_REPLY"].includes(intent) ? "No reply needed for this message type" :
    business?.doNotContact ? "Lead is Do Not Contact" :
    business?.aiPaused ? "AI paused for this lead" :
    business?.humanTakeover ? "Human has taken over" :
    !responseNeeded ? "AI judged that no response is needed" : null;

  let draftId: string | null = null;
  let draftIssues: string[] = [];
  let missingInfo: string[] = [];
  let draftBody = "";
  let draftAiReview = false;
  let draftReviewReason = "";
  if (!blockedForDraft && ai) {
    try {
      const d = await ai.json({
        feature: "reply_drafting",
        system: `You draft email replies on behalf of ${company.senderName || "the sender"} at ${company.companyName || "a small web agency"}.
Read the ENTIRE conversation and reply to the latest message from THEM in context.
Hard rules — never break them:
- Do NOT invent prices, discounts, meeting availability, services, guarantees, deadlines, turnaround times or contract terms. Use only what is in COMPANY FACTS.
- If they ask for something not in COMPANY FACTS (e.g. price when no pricing is configured), acknowledge it, offer to follow up with specifics, and list it in missing_info.
- If a meeting is requested and a meeting link exists, you may share the link; never propose specific times yourself.
- Do not claim to be human or make claims about the business you contacted beyond what the conversation states.
- Tone: ${automation.responseTone}. Max ${automation.maxResponseWords} words. Plain text. No subject line, no signature (added automatically). Start with a greeting using their name if known.`,
        prompt: `COMPANY FACTS\nCompany: ${company.companyName}\nWhat we do: ${company.description}\nServices: ${company.services.join(", ") || "(not listed)"}\nPricing: ${company.pricingEnabled && company.pricingDetails ? company.pricingDetails : "NOT CONFIGURED — do not state any price"}\nMeeting link: ${company.meetingLink || "NOT CONFIGURED — do not propose times"}\nPermitted claims: ${company.permittedClaims || "(none beyond the above)"}\nBrand voice: ${company.brandVoice}\n\nBUSINESS: ${business?.name ?? "unknown"}\nINTENT: ${intent}${contextResolution ? `\nCONTEXT: ${contextResolution}` : ""}\n\nCONVERSATION (oldest first):\n${renderThread(thread)}\n\nWrite the reply to message #${thread.length}.`,
        schema: DraftSchema,
        maxTokens: 3000,
      });
      draftBody = d.body.trim();
      missingInfo = d.missing_info.filter((x) => x.trim());
      draftAiReview = d.requires_human_review;
      draftReviewReason = d.review_reason;
      draftIssues = scanCommitments(draftBody, company);
      const words = draftBody.split(/\s+/).length;
      if (words > automation.maxResponseWords * 1.3) draftIssues.push(`Draft is ${words} words (limit ${automation.maxResponseWords})`);
    } catch (e) {
      notes.push(`Draft generation failed: ${describeError(e)}`);
    }
  }

  const decision = evaluateAutoSend({
    responseMode: automation.responseMode,
    automaticRepliesEnabled: automation.automaticReplies,
    minConfidence: automation.autoReplyMinConfidence,
    intent,
    confidence,
    sensitiveFlags,
    aiRequestedReview: aiRequestedReview || draftAiReview,
    draftIssues,
    missingInfo,
    businessDoNotContact: Boolean(business?.doNotContact),
    aiPaused: Boolean(business?.aiPaused),
    humanTakeover: Boolean(business?.humanTakeover),
    hasDraft: Boolean(draftBody),
    isFirstReplyInThread: thread.filter((m) => m.direction === "INBOUND").length === 1,
    pricingConfigured: company.pricingEnabled && Boolean(company.pricingDetails.trim()),
  });
  const reviewReasons = decision.reasons.filter((r) => !/Workspace requires approval|Automatic replies are switched off|Manual mode/.test(r));
  if (aiReviewReason && aiRequestedReview) reviewReasons.push(`AI: ${aiReviewReason}`);
  if (draftReviewReason && draftAiReview) reviewReasons.push(`AI: ${draftReviewReason}`);
  if (!business) reviewReasons.push("Sender could not be matched to a lead");
  const needsHumanReview = sensitiveFlags.length > 0 || confidence < automation.humanReviewBelowConfidence || aiRequestedReview || draftAiReview || draftIssues.length > 0 || !business || intent === "CONFUSED" || intent === "OTHER";

  if (draftBody) {
    await db.aiResponseDraft.updateMany({ where: { conversationId: conv.id, status: "PENDING" }, data: { status: "SUPERSEDED" } });
    const draft = await db.aiResponseDraft.create({
      data: {
        workspaceId,
        conversationId: conv.id,
        businessId: business?.id ?? null,
        inboundMessageId: message.id,
        intent,
        secondaryIntents: secondary,
        confidence,
        leadScore,
        recommendedAction: recommended,
        requiresReview: !decision.autoSend,
        reviewReasons: Array.from(new Set(reviewReasons)),
        missingInfo,
        subject: message.subject.toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject}`,
        body: draftBody,
        model: ai?.model ?? null,
      },
    });
    draftId = draft.id;
    await logActivity({ workspaceId, businessId: business?.id, action: "ai.draft_generated", summary: `AI response drafted (${intent.replace(/_/g, " ").toLowerCase()}, ${confidence}% confidence)`, details: { draftId } });
  }

  await db.conversation.update({
    where: { id: conv.id },
    data: {
      lastIntent: intent,
      lastConfidence: confidence,
      isHot,
      needsHumanReview: needsHumanReview && !decision.autoSend,
      reviewReason: needsHumanReview ? Array.from(new Set([...rules.sensitive.map((s) => s.reason), ...reviewReasons])).join("; ") || "Low confidence" : blockedForDraft && responseNeeded ? blockedForDraft : null,
    },
  });

  if (decision.autoSend && draftId && business?.email) {
    try {
      const { sendEmail } = await import("../email/send");
      const draft = await db.aiResponseDraft.findUniqueOrThrow({ where: { id: draftId } });
      const sent = await sendEmail({ workspaceId, userId: null, to: message.fromAddress, subject: draft.subject, body: draft.body, kind: "AI_REPLY", businessId: business.id, conversationId: conv.id, aiGenerated: true, automated: true });
      await db.aiResponseDraft.update({ where: { id: draftId }, data: { status: "AUTO_SENT", sentMessageId: sent.message.id, decidedAt: new Date() } });
      await logActivity({ workspaceId, businessId: business.id, action: "ai.response_auto_sent", summary: `AI response sent automatically (${confidence}% confidence)` });
      return { intent, confidence, draftId, autoSent: true, reviewReasons: [] };
    } catch (e) {
      await db.aiResponseDraft.update({ where: { id: draftId }, data: { requiresReview: true, reviewReasons: { push: `Automatic send failed: ${describeError(e)}` } } });
      await db.conversation.update({ where: { id: conv.id }, data: { needsHumanReview: true, reviewReason: `Automatic send failed: ${describeError(e)}` } });
    }
  }

  if (draftId && business) await changeLeadStatus({ workspaceId, businessId: business.id, to: "AI_RESPONSE_READY", automatic: true, reason: "AI draft ready for approval" });
  await notify({ workspaceId, type: "NEW_RESPONSE", title: `${business?.name ?? message.fromAddress} replied`, body: summary || newText.slice(0, 160), link: `/inbox/${conv.id}` });
  if (draftId) await notify({ workspaceId, type: "AI_DRAFT_READY", title: `AI response ready for ${business?.name ?? message.fromAddress}`, body: needsHumanReview ? "Human review required before sending." : "Review and approve to send.", link: `/inbox/${conv.id}` });
  if (needsHumanReview) await notify({ workspaceId, type: "HUMAN_REVIEW", title: `Review needed: ${business?.name ?? message.fromAddress}`, body: reviewReasons[0] ?? rules.sensitive[0]?.reason ?? "Low confidence", link: `/inbox/${conv.id}` });
  return { intent, confidence, draftId, autoSent: false, reviewReasons };
}

function defaultAction(intent: Intent) {
  return (
    {
      INTERESTED: "Reply with next steps and offer to share the specific website ideas",
      QUESTION: "Answer the question",
      PRICING: "Answer pricing (only with configured pricing) or offer a tailored quote",
      REQUEST_FOR_MEETING: "Confirm a meeting time (use your meeting link)",
      REQUEST_FOR_PHONE_CALL: "Call them back",
      NOT_INTERESTED: "Thank them and close the conversation; consider marking Lost",
      UNSUBSCRIBE: "Stop all contact",
      CONFUSED: "Clarify who you are and why you reached out",
      COMPLAINT: "Human should respond personally and consider marking Do Not Contact",
      LEGAL: "Escalate to a human; do not reply automatically",
      PAYMENT: "Human should handle payment matters",
      SPAM: "No action",
      AUTO_REPLY: "No action; wait for their return",
      OTHER: "Read and respond manually",
    } as Record<Intent, string>
  )[intent];
}

/** Regenerates the AI draft for a conversation's latest inbound message. */
export async function regenerateDraft(workspaceId: string, conversationId: string) {
  const last = await db.emailMessage.findFirst({ where: { workspaceId, conversationId, direction: "INBOUND" }, orderBy: { createdAt: "desc" } });
  if (!last) throw new AppError("NOT_FOUND", "There is no inbound message to reply to.");
  return analyzeInboundMessage(workspaceId, last.id);
}
