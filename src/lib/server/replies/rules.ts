import type { Intent } from "@prisma/client";

/**
 * Deterministic safety classifier. Runs on every inbound message regardless of
 * AI configuration. High-precision patterns for situations that must never be
 * auto-handled (legal, complaints, payments, unsubscribe, threats, etc.).
 */
export type RuleResult = {
  intents: Intent[];
  sensitive: { flag: string; reason: string }[];
  unsubscribe: boolean;
  autoReply: boolean;
  confidence: number;
  primary: Intent;
};

const P = {
  unsubscribe: /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|messaging)|do not (contact|email)|don'?t (contact|email) (me|us)( again)?|no more emails|opt[ -]?out|leave us alone|please stop)\b/i,
  notInterested: /\b(not interested|no thanks|no thank you|we('| a)re (all )?set|we('| a)re good|not at this time|not right now|we already have|happy with (our|the) (current )?(site|website)|pass on this)\b/i,
  legal: /\b(lawyer|attorney|legal action|lawsuit|sue\b|suing|cease and desist|court|solicitor|counsel|gdpr|casl|can-spam|ccpa|report(ing)? you|regulator|privacy commissioner)\b/i,
  threat: /\b(threat|harass|i will (find|hurt)|you('| wi)ll regret|police)\b/i,
  complaint: /\b(complain|complaint|spam(ming)?|annoying|harassment|how did you get (my|this) (email|address)|who gave you|scam|unsolicited|reported as spam)\b/i,
  payment: /\b(invoice|payment|pay (you|now)|paid|refund|charged|chargeback|credit card|bank (transfer|details)|wire transfer|billing|receipt|deposit)\b/i,
  contract: /\b(contract|agreement|terms|sign(ed|ing)?\b|nda|statement of work|sow|retainer)\b/i,
  sensitive: /\b(password|social security|ssn|sin number|date of birth|passport|medical|diagnosis|health record|credit card number|account number)\b/i,
  security: /\b(hack(ed)?|breach|phishing|malware|virus|compromised|security (issue|incident))\b/i,
  pricing: /\b(how much|price|pricing|cost|costs|quote|estimate|rates?|budget|charge|fees?|what do you charge|ballpark)\b/i,
  meeting: /\b(meet(ing)?|(a|quick|short|phone) call|call (me|us)|chat|zoom|teams|google meet|calendar|schedule|available|availability|tuesday|wednesday|thursday|friday|monday|saturday|sunday|tomorrow|next week|this week|works for (me|us)|book a time)\b/i,
  phone: /\b(call me|give me a call|phone me|ring me|my (cell|number|phone) is|reach me at)\b|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i,
  interested: /\b(interested|sounds (good|great|interesting)|tell me more|let'?s (talk|chat|do it)|yes,? please|i'?d like (to|that)|send (it|them|me) (over|the ideas)|keen|go ahead|love to (hear|see))\b/i,
  question: /\?|\b(what|how|when|where|who|why|can you|could you|do you|is it|are you)\b/i,
  confused: /\b(who is this|who are you|what is this (about|regarding)|i don'?t understand|confused|wrong (person|email)|not sure what you mean)\b/i,
  autoReply: /\b(out of (the )?office|auto(matic)?[- ]?reply|on vacation|away from (my|the) (desk|office)|limited access to email|will respond (when|upon) (i|my) return|this is an automated)\b/i,
  spam: /\b(seo services|guest post|backlinks|crypto|bitcoin|forex|casino|viagra|loan offer|congratulations you('| ha)ve won)\b/i,
};

export function ruleClassify(text: string, subject = ""): RuleResult {
  const t = `${subject}\n${text}`.slice(0, 6000);
  const intents: Intent[] = [];
  const sensitive: RuleResult["sensitive"] = [];
  const unsubscribe = P.unsubscribe.test(t);
  const autoReply = P.autoReply.test(t);
  if (unsubscribe) intents.push("UNSUBSCRIBE");
  if (P.legal.test(t)) {
    intents.push("LEGAL");
    sensitive.push({ flag: "legal", reason: "Mentions legal matters or regulators" });
  }
  if (P.threat.test(t)) sensitive.push({ flag: "threat", reason: "Potentially threatening or hostile language" });
  if (P.complaint.test(t)) {
    intents.push("COMPLAINT");
    sensitive.push({ flag: "complaint", reason: "Complaint or spam accusation" });
  }
  if (P.payment.test(t)) {
    intents.push("PAYMENT");
    sensitive.push({ flag: "payment", reason: "Mentions payments, invoices or refunds" });
  }
  if (P.contract.test(t) && /\b(contract|agreement|nda|statement of work|sow|retainer)\b/i.test(t)) sensitive.push({ flag: "contract", reason: "Mentions contracts or agreements" });
  if (P.sensitive.test(t)) sensitive.push({ flag: "sensitive_info", reason: "Contains or requests sensitive personal information" });
  if (P.security.test(t)) sensitive.push({ flag: "security", reason: "Mentions a security issue" });
  if (unsubscribe) sensitive.push({ flag: "unsubscribe", reason: "Unsubscribe / do-not-contact request" });
  if (autoReply) intents.push("AUTO_REPLY");
  if (P.spam.test(t)) intents.push("SPAM");
  if (P.notInterested.test(t) && !unsubscribe) intents.push("NOT_INTERESTED");
  if (P.confused.test(t)) intents.push("CONFUSED");
  if (P.pricing.test(t)) intents.push("PRICING");
  if (P.phone.test(t) && /call|phone|ring|number/i.test(t)) intents.push("REQUEST_FOR_PHONE_CALL");
  if (P.meeting.test(t)) intents.push("REQUEST_FOR_MEETING");
  if (P.interested.test(t) && !P.notInterested.test(t)) intents.push("INTERESTED");
  if (P.question.test(t) && !intents.length) intents.push("QUESTION");

  const priority: Intent[] = ["UNSUBSCRIBE", "LEGAL", "COMPLAINT", "PAYMENT", "SPAM", "AUTO_REPLY", "NOT_INTERESTED", "CONFUSED", "REQUEST_FOR_PHONE_CALL", "REQUEST_FOR_MEETING", "PRICING", "INTERESTED", "QUESTION"];
  const primary = priority.find((p) => intents.includes(p)) ?? "OTHER";
  const confidence = primary === "OTHER" ? 30 : ["UNSUBSCRIBE", "AUTO_REPLY"].includes(primary) ? 90 : sensitive.length ? 75 : 60;
  return { intents: Array.from(new Set(intents)), sensitive, unsubscribe, autoReply, confidence, primary };
}
