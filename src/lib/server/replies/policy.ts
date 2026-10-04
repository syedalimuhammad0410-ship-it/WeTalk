import type { Intent } from "@prisma/client";

export type AutoSendInput = {
  responseMode: "MANUAL" | "APPROVAL_REQUIRED" | "AUTOMATIC";
  automaticRepliesEnabled: boolean;
  minConfidence: number;
  intent: Intent;
  confidence: number;
  sensitiveFlags: string[];
  aiRequestedReview: boolean;
  draftIssues: string[];
  missingInfo: string[];
  businessDoNotContact: boolean;
  aiPaused: boolean;
  humanTakeover: boolean;
  hasDraft: boolean;
  isFirstReplyInThread: boolean;
  pricingConfigured: boolean;
};

const NEVER_AUTO_INTENTS: Intent[] = ["LEGAL", "COMPLAINT", "PAYMENT", "UNSUBSCRIBE", "CONFUSED", "SPAM", "OTHER", "AUTO_REPLY", "NOT_INTERESTED"];
const AUTO_SAFE_INTENTS: Intent[] = ["INTERESTED", "QUESTION", "REQUEST_FOR_MEETING", "REQUEST_FOR_PHONE_CALL", "PRICING"];

/**
 * Decides whether an AI draft may be sent without a human. Returns the
 * decision and every reason it was blocked, so the UI can explain it.
 * Default-deny: any doubt routes to human review.
 */
export function evaluateAutoSend(i: AutoSendInput): { autoSend: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (i.responseMode !== "AUTOMATIC") reasons.push(i.responseMode === "MANUAL" ? "Workspace is in Manual mode" : "Workspace requires approval for AI responses");
  if (!i.automaticRepliesEnabled) reasons.push("Automatic replies are switched off in Automation settings");
  if (i.businessDoNotContact) reasons.push("Lead is marked Do Not Contact");
  if (i.aiPaused) reasons.push("AI is paused for this conversation");
  if (i.humanTakeover) reasons.push("A team member has taken over this conversation");
  if (!i.hasDraft) reasons.push("No draft was generated");
  if (NEVER_AUTO_INTENTS.includes(i.intent)) reasons.push(`Intent “${i.intent.replace(/_/g, " ").toLowerCase()}” always requires a human`);
  if (!AUTO_SAFE_INTENTS.includes(i.intent) && !NEVER_AUTO_INTENTS.includes(i.intent)) reasons.push("Unknown request type");
  if (i.confidence < i.minConfidence) reasons.push(`Confidence ${i.confidence}% is below the ${i.minConfidence}% threshold`);
  for (const f of i.sensitiveFlags) reasons.push(`Sensitive topic detected: ${f.replace(/_/g, " ")}`);
  if (i.aiRequestedReview) reasons.push("The AI flagged this message for human review");
  for (const d of i.draftIssues) reasons.push(`Draft check: ${d}`);
  if (i.missingInfo.length) reasons.push(`Needs information you haven't configured: ${i.missingInfo.join(", ")}`);
  if (i.intent === "PRICING" && !i.pricingConfigured) reasons.push("Pricing question but no pricing is configured in the company profile");
  return { autoSend: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}
