import { describe, expect, it } from "vitest";
import { ruleClassify } from "@/lib/server/replies/rules";
import { evaluateAutoSend, type AutoSendInput } from "@/lib/server/replies/policy";

describe("rule-based reply classifier", () => {
  const cases: [string, string][] = [
    ["Please don't contact us again.", "UNSUBSCRIBE"],
    ["unsubscribe", "UNSUBSCRIBE"],
    ["Remove me from your list", "UNSUBSCRIBE"],
    ["Hi, thanks for reaching out. We're interested. How much do you charge?", "PRICING"],
    ["Sounds good. Tuesday works.", "REQUEST_FOR_MEETING"],
    ["Can you give me a call? My number is 905-555-0101", "REQUEST_FOR_PHONE_CALL"],
    ["No thanks, we already have a web guy.", "NOT_INTERESTED"],
    ["I'll have my lawyer contact you about this unsolicited email.", "LEGAL"],
    ["How did you get my email? This is spam.", "COMPLAINT"],
    ["Please send the invoice for the deposit", "PAYMENT"],
    ["I am out of the office until Monday and will respond upon my return.", "AUTO_REPLY"],
    ["Who is this? I don't understand", "CONFUSED"],
    ["Yes please, send them over!", "INTERESTED"],
  ];
  it.each(cases)("%s → %s", (text, intent) => {
    expect(ruleClassify(text).primary).toBe(intent);
  });
  it("flags sensitive topics", () => {
    const r = ruleClassify("We want a refund and our attorney will be in touch");
    expect(r.sensitive.map((s) => s.flag)).toEqual(expect.arrayContaining(["legal", "payment"]));
  });
  it("does not treat plain pricing questions as payments", () => {
    expect(ruleClassify("what would you charge for this?").sensitive).toHaveLength(0);
  });
});

describe("automatic-send policy (default deny)", () => {
  const ok: AutoSendInput = {
    responseMode: "AUTOMATIC", automaticRepliesEnabled: true, minConfidence: 90, intent: "INTERESTED", confidence: 95, sensitiveFlags: [], aiRequestedReview: false,
    draftIssues: [], missingInfo: [], businessDoNotContact: false, aiPaused: false, humanTakeover: false, hasDraft: true, isFirstReplyInThread: true, pricingConfigured: false,
  };
  it("allows a clean, confident, interested reply in automatic mode", () => {
    expect(evaluateAutoSend(ok)).toEqual({ autoSend: true, reasons: [] });
  });
  it.each<[string, Partial<AutoSendInput>, RegExp]>([
    ["approval mode", { responseMode: "APPROVAL_REQUIRED" }, /approval/],
    ["switch off", { automaticRepliesEnabled: false }, /switched off/],
    ["low confidence", { confidence: 80 }, /below the 90% threshold/],
    ["legal", { intent: "LEGAL" }, /always requires a human/],
    ["complaint", { intent: "COMPLAINT" }, /always requires a human/],
    ["payment", { intent: "PAYMENT" }, /always requires a human/],
    ["unsubscribe", { intent: "UNSUBSCRIBE" }, /always requires a human/],
    ["unknown", { intent: "OTHER" }, /always requires a human/],
    ["sensitive", { sensitiveFlags: ["threat"] }, /Sensitive topic/],
    ["DNC", { businessDoNotContact: true }, /Do Not Contact/],
    ["paused", { aiPaused: true }, /paused/],
    ["takeover", { humanTakeover: true }, /taken over/],
    ["draft issue", { draftIssues: ["Mentions a price"] }, /Draft check/],
    ["missing info", { missingInfo: ["pricing"] }, /haven't configured/],
    ["pricing w/o config", { intent: "PRICING" }, /no pricing is configured/],
    ["AI asked review", { aiRequestedReview: true }, /flagged/],
  ])("blocks: %s", (_n, patch, re) => {
    const r = evaluateAutoSend({ ...ok, ...patch });
    expect(r.autoSend).toBe(false);
    expect(r.reasons.join(" | ")).toMatch(re);
  });
});
