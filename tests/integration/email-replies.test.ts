import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/server/email/send";
import { ingestInbound } from "@/lib/server/email/inbound";
import { generateOutreachDraft } from "@/lib/server/email/compose";
import { approveDraft, setConversationControl } from "@/lib/server/replies/actions";
import { dispatchDueFollowUps, approveFollowUp } from "@/lib/server/followups";
import { setEmailProviderOverrideForTests, type InboundEmail } from "@/lib/server/email/providers";
import { changeLeadStatus } from "@/lib/server/leads";
import { encryptSecret } from "@/lib/server/crypto";
import { fakeAi, makeWorkspace, noAi } from "../helpers";

let seq = 0;
const inbound = (from: string, text: string, extra: Partial<InboundEmail> = {}): InboundEmail => ({
  providerMessageId: `in-${Date.now()}-${++seq}`, rfcMessageId: `<in-${seq}@biz.test>`, inReplyTo: null, references: null, providerThreadId: null, from, fromName: null, to: "agency@studio.test", subject: "Re: A website idea", text, html: null, receivedAt: new Date(), ...extra,
});

async function setup(opts: Parameters<typeof makeWorkspace>[0] = {}) {
  const { ws, owner } = await makeWorkspace(opts);
  const b = await db.business.create({ data: { workspaceId: ws.id, name: "ABC Cleaning", normalizedName: "abc cleaning", businessType: "cleaning", city: "Mississauga", email: "owner@abc.test", emailSource: "Website", websiteDomain: "abc.test" } });
  const account = await db.emailAccount.findFirst({ where: { workspaceId: ws.id } });
  return { ws, owner, b, account };
}

async function sendOutreach(ws: string, user: string, b: string) {
  return sendEmail({ workspaceId: ws, userId: user, to: "owner@abc.test", subject: "A website idea for ABC Cleaning", body: "Hi there,\nI noticed one thing.", kind: "OUTREACH", businessId: b });
}

describe("email sending safeguards", () => {
  beforeEach(() => noAi());

  it("sends via the provider, threads, appends compliance footer, schedules bounded follow-ups", async () => {
    const { ws, owner, b } = await setup();
    await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { physicalAddress: "1 King St W, Toronto" } });
    const r = await sendOutreach(ws.id, owner.id, b.id);
    expect(r.sandbox).toBe(true);
    expect(r.message.status).toBe("SENT");
    expect(r.message.bodyText).toContain("unsubscribe");
    expect(r.message.bodyText).toContain("1 King St W, Toronto");
    expect(r.message.rfcMessageId).toMatch(/^<.+@.+>$/);
    const lead = await db.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(lead.status).toBe("CONTACTED");
    const fus = await db.followUp.findMany({ where: { businessId: b.id } });
    expect(fus.map((f) => f.step)).toEqual([1, 2]);
    await expect(sendOutreach(ws.id, owner.id, b.id)).rejects.toThrow(/already received initial outreach/);
  });

  it("enforces hourly/daily limits and minimum delay atomically", async () => {
    const { ws, owner } = await setup();
    await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { maxEmailsPerHour: 2 } });
    for (let i = 0; i < 2; i++) await sendEmail({ workspaceId: ws.id, userId: owner.id, to: `x${i}@x.test`, subject: "s", body: "b", kind: "REPLY" });
    await expect(sendEmail({ workspaceId: ws.id, userId: owner.id, to: "x9@x.test", subject: "s", body: "b", kind: "REPLY" })).rejects.toThrow(/Hourly sending limit/);
    await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { maxEmailsPerHour: 100, minMinutesBetweenSends: 5 } });
    await expect(sendEmail({ workspaceId: ws.id, userId: owner.id, to: "x8@x.test", subject: "s", body: "b", kind: "REPLY" })).rejects.toThrow(/Minimum delay/);
  });

  it("blocks Do-Not-Contact, suppressed recipients and unfilled template variables", async () => {
    const { ws, owner, b } = await setup();
    await expect(sendEmail({ workspaceId: ws.id, userId: owner.id, to: "owner@abc.test", subject: "Hi {{business_name}}", body: "b", kind: "OUTREACH", businessId: b.id })).rejects.toThrow(/unfilled template variables/);
    await changeLeadStatus({ workspaceId: ws.id, businessId: b.id, to: "DO_NOT_CONTACT", userId: owner.id });
    await expect(sendOutreach(ws.id, owner.id, b.id)).rejects.toThrow(/on the do-not-contact list/);
    await expect(sendEmail({ workspaceId: ws.id, userId: owner.id, to: "owner@abc.test", subject: "s", body: "b", kind: "REPLY" })).rejects.toThrow(/do-not-contact/);
    expect(await db.emailMessage.count({ where: { workspaceId: ws.id, status: "SENT" } })).toBe(0);
  });

  it("records provider failures, notifies, and never marks them sent", async () => {
    const { ws, owner, b } = await setup();
    setEmailProviderOverrideForTests(() => ({ send: async () => { throw new Error("SMTP exploded"); }, fetchInbound: async () => [] }));
    await expect(sendOutreach(ws.id, owner.id, b.id)).rejects.toThrow(/SMTP exploded/);
    setEmailProviderOverrideForTests(null);
    const m = await db.emailMessage.findFirstOrThrow({ where: { workspaceId: ws.id } });
    expect(m.status).toBe("FAILED");
    expect(await db.notification.count({ where: { workspaceId: ws.id, type: "EMAIL_FAILURE" } })).toBeGreaterThan(0);
  });

  it("Postmark provider sends with threading headers (HTTP mocked)", async () => {
    const { ws, owner, b } = await setup({ sandbox: false });
    await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "POSTMARK", emailAddress: "alex@studio.test", apiTokenEncrypted: encryptSecret("pm-token-123"), inboundAddress: "hash@inbound.postmarkapp.com" } });
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(String(init!.body));
      expect((init!.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe("pm-token-123");
      expect(body.ReplyTo).toMatch(/^hash\+.+@inbound\.postmarkapp\.com$/);
      expect(body.Headers.find((h: { Name: string }) => h.Name === "Message-ID")).toBeTruthy();
      return new Response(JSON.stringify({ MessageID: "pm-1", ErrorCode: 0 }), { status: 200 });
    });
    const r = await sendOutreach(ws.id, owner.id, b.id);
    expect(r.message.providerMessageId).toBe("pm-1");
    spy.mockRestore();
  });
});

describe("inbound matching and reply analysis", () => {
  beforeEach(() => noAi());

  it("matches by In-Reply-To, stores once (idempotent), stops follow-ups, marks Responded", async () => {
    const { ws, owner, b, account } = await setup();
    const sent = await sendOutreach(ws.id, owner.id, b.id);
    const msg = inbound("owner@abc.test", "Thanks — could you tell me more?", { inReplyTo: sent.message.rfcMessageId });
    const r = await ingestInbound(account!, msg, { analyze: "inline" });
    expect(r!.matchedBy).toBe("in_reply_to");
    expect(r!.conversationId).toBe(sent.conversationId);
    const again = await ingestInbound(account!, msg, { analyze: "inline" });
    expect(again!.duplicate).toBe(true);
    expect(await db.emailMessage.count({ where: { workspaceId: ws.id, direction: "INBOUND" } })).toBe(1);
    expect((await db.followUp.findMany({ where: { businessId: b.id } })).every((f) => f.status === "CANCELLED" && f.cancelReason === "Business replied")).toBe(true);
    expect((await db.business.findUniqueOrThrow({ where: { id: b.id } })).status).not.toBe("CONTACTED");
  });

  it("matches by mailbox hash, by sender email, by domain; flags unmatched senders", async () => {
    const { ws, owner, b, account } = await setup();
    const sent = await sendOutreach(ws.id, owner.id, b.id);
    expect((await ingestInbound(account!, inbound("someone@else.test", "hi", { mailboxHash: sent.conversationId }), { analyze: "inline" }))!.matchedBy).toBe("mailbox_hash");
    expect((await ingestInbound(account!, inbound("owner@abc.test", "hello again"), { analyze: "inline" }))!.matchedBy).toBe("sender_email");
    const d = await ingestInbound(account!, inbound("manager@abc.test", "Who is this?"), { analyze: "inline" });
    expect(d!.matchedBy).toBe("sender_domain");
    const u = await ingestInbound(account!, inbound("random@nowhere.test", "hello?"), { analyze: "inline" });
    expect(u!.matchedBy).toBe("unmatched");
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: u!.conversationId! } });
    expect(conv.needsHumanReview).toBe(true);
    expect(conv.businessId).toBeNull();
  });

  it("unsubscribe → Do Not Contact immediately; future outreach, follow-ups and AI replies stop", async () => {
    const { ws, owner, b, account } = await setup();
    const sent = await sendOutreach(ws.id, owner.id, b.id);
    await ingestInbound(account!, inbound("owner@abc.test", "Please don't contact us again.", { inReplyTo: sent.message.rfcMessageId }), { analyze: "inline" });
    const lead = await db.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(lead.status).toBe("DO_NOT_CONTACT");
    expect(lead.doNotContact).toBe(true);
    expect(lead.doNotContactAt).toBeInstanceOf(Date);
    expect(await db.suppressionEntry.findFirst({ where: { workspaceId: ws.id, value: "owner@abc.test" } })).toBeTruthy();
    expect(await db.aiResponseDraft.count({ where: { businessId: b.id, status: "PENDING" } })).toBe(0);
    await expect(sendEmail({ workspaceId: ws.id, userId: owner.id, to: "owner@abc.test", subject: "Follow up", body: "x", kind: "FOLLOW_UP", businessId: b.id })).rejects.toThrow(/do-not-contact/i);
    // Automatic status changes never pull a lead out of DNC.
    await changeLeadStatus({ workspaceId: ws.id, businessId: b.id, to: "INTERESTED", automatic: true });
    expect((await db.business.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("DO_NOT_CONTACT");
  });

  it("AI reads the whole thread, drafts without inventing price, and a human approves", async () => {
    const { ws, owner, b, account } = await setup();
    const calls = fakeAi({
      reply_analysis: (p) => ({ intent: p.includes("Tuesday works") ? "REQUEST_FOR_MEETING" : "PRICING", secondary_intents: ["INTERESTED"], confidence: 92, lead_score: 85, summary: "Interested; asks about price", context_resolution: p.includes("Tuesday works") ? "Tuesday refers to the call proposed in message #3" : "", questions_asked: ["How much?"], recommended_action: "Answer pricing", response_needed: true, requires_human_review: false, review_reason: "" }),
      reply_drafting: () => ({ body: "Thanks for getting back to me. I'd be happy to put together a more specific quote based on the features you'd like.", missing_info: ["pricing"], requires_human_review: false, review_reason: "" }),
    });
    const sent = await sendOutreach(ws.id, owner.id, b.id);
    const r1 = await ingestInbound(account!, inbound("owner@abc.test", "Hi, thanks for reaching out. We're interested. How much do you charge?", { inReplyTo: sent.message.rfcMessageId }), { analyze: "inline" });
    const draft = await db.aiResponseDraft.findFirstOrThrow({ where: { conversationId: r1!.conversationId!, status: "PENDING" } });
    expect(draft.intent).toBe("PRICING");
    expect(draft.body).not.toMatch(/\$\d/);
    expect(draft.missingInfo).toContain("pricing");
    expect(draft.requiresReview).toBe(true);
    expect((await db.business.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("AI_RESPONSE_READY");
    const ap = await approveDraft(ws.id, draft.id, owner.id, { body: `${draft.body}\nWould a quick call help?` });
    expect(ap.message.kind).toBe("AI_REPLY");
    expect(ap.message.inReplyTo).toBe(`<in-${seq}@biz.test>`);
    expect((await db.aiResponseDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("SENT");
    // The business replies again — the analysis prompt receives the full conversation.
    await ingestInbound(account!, inbound("owner@abc.test", "Sounds good. Tuesday works.", { inReplyTo: ap.message.rfcMessageId }), { analyze: "inline" });
    const last = calls.filter((c) => c.feature === "reply_analysis").pop()!;
    expect(last.prompt).toContain("How much do you charge?");
    expect(last.prompt).toContain("Would a quick call help?");
    expect(last.prompt).toContain("Sounds good. Tuesday works.");
    const lead = await db.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(["INTERESTED", "AI_RESPONSE_READY"]).toContain(lead.status);
    expect(await db.notification.count({ where: { workspaceId: ws.id, type: "MEETING_REQUESTED" } })).toBeGreaterThan(0);
  });

  it("automatic mode sends only safe, confident replies; legal/complaint always go to a human", async () => {
    const { ws, owner, b, account } = await setup();
    await db.automationSettings.update({ where: { workspaceId: ws.id }, data: { responseMode: "AUTOMATIC", automaticReplies: true } });
    fakeAi({
      reply_analysis: (p) => ({ intent: /lawyer/.test(p) ? "INTERESTED" : "INTERESTED", secondary_intents: [], confidence: 96, lead_score: 80, summary: "", context_resolution: "", questions_asked: [], recommended_action: "Reply", response_needed: true, requires_human_review: false, review_reason: "" }),
      reply_drafting: () => ({ body: "Great — I'll send over the ideas today.", missing_info: [], requires_human_review: false, review_reason: "" }),
    });
    const sent = await sendOutreach(ws.id, owner.id, b.id);
    const ok = await ingestInbound(account!, inbound("owner@abc.test", "Yes please, send them over!", { inReplyTo: sent.message.rfcMessageId }), { analyze: "inline" });
    expect(await db.aiResponseDraft.count({ where: { conversationId: ok!.conversationId!, status: "AUTO_SENT" } })).toBe(1);
    // Even though the (fake) AI says INTERESTED with 96%, the rule layer catches the legal threat.
    const bad = await ingestInbound(account!, inbound("owner@abc.test", "Stop or my lawyer will file a complaint about this spam."), { analyze: "inline" });
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: bad!.conversationId! } });
    expect(conv.needsHumanReview).toBe(true);
    expect(conv.reviewReason).toMatch(/legal|Complaint/i);
    expect(await db.aiResponseDraft.count({ where: { conversationId: bad!.conversationId!, status: "AUTO_SENT" } })).toBe(1);
  });

  it("Pause AI / Take Over / Do Not Contact controls stop AI drafting", async () => {
    const { ws, owner, b, account } = await setup();
    fakeAi({ reply_analysis: () => ({ intent: "QUESTION", secondary_intents: [], confidence: 90, lead_score: 50, summary: "", context_resolution: "", questions_asked: [], recommended_action: "", response_needed: true, requires_human_review: false, review_reason: "" }), reply_drafting: () => ({ body: "x", missing_info: [], requires_human_review: false, review_reason: "" }) });
    const sent = await sendOutreach(ws.id, owner.id, b.id);
    await setConversationControl(ws.id, sent.conversationId, owner.id, "PAUSE_AI");
    await ingestInbound(account!, inbound("owner@abc.test", "What platforms do you use?"), { analyze: "inline" });
    expect(await db.aiResponseDraft.count({ where: { conversationId: sent.conversationId } })).toBe(0);
    await setConversationControl(ws.id, sent.conversationId, owner.id, "RESUME_AI");
    await setConversationControl(ws.id, sent.conversationId, owner.id, "TAKE_OVER");
    await ingestInbound(account!, inbound("owner@abc.test", "Another question?"), { analyze: "inline" });
    expect(await db.aiResponseDraft.count({ where: { conversationId: sent.conversationId } })).toBe(0);
    await setConversationControl(ws.id, sent.conversationId, owner.id, "DO_NOT_CONTACT");
    expect((await db.business.findUniqueOrThrow({ where: { id: b.id } })).doNotContact).toBe(true);
  });
});

describe("follow-ups", () => {
  beforeEach(() => noAi());

  it("waits for approval by default, sends when approved, and respects the maximum", async () => {
    const { ws, owner, b } = await setup();
    await sendOutreach(ws.id, owner.id, b.id);
    await db.followUp.updateMany({ where: { businessId: b.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    const r = await dispatchDueFollowUps(ws.id);
    expect(r.pendingApproval).toBe(2);
    const [f1, f2] = await db.followUp.findMany({ where: { businessId: b.id }, orderBy: { step: "asc" } });
    expect(f1!.body).toContain("ABC Cleaning");
    await approveFollowUp(ws.id, f1!.id, owner.id);
    await approveFollowUp(ws.id, f2!.id, owner.id);
    expect(await db.emailMessage.count({ where: { businessId: b.id, kind: "FOLLOW_UP", status: "SENT" } })).toBe(2);
    await expect(sendEmail({ workspaceId: ws.id, userId: owner.id, to: "owner@abc.test", subject: "x", body: "y", kind: "FOLLOW_UP", businessId: b.id })).rejects.toThrow(/Maximum follow-ups/);
  });

  it("automatic follow-ups send when due and stop when the lead becomes a customer", async () => {
    const { ws, owner, b } = await setup();
    await db.automationSettings.update({ where: { workspaceId: ws.id }, data: { automaticFollowUps: true } });
    await sendOutreach(ws.id, owner.id, b.id);
    await db.followUp.updateMany({ where: { businessId: b.id, step: 1 }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    expect((await dispatchDueFollowUps(ws.id)).sent).toBe(1);
    await changeLeadStatus({ workspaceId: ws.id, businessId: b.id, to: "WON", userId: owner.id });
    const f2 = await db.followUp.findFirstOrThrow({ where: { businessId: b.id, step: 2 } });
    expect(f2.status).toBe("CANCELLED");
  });

  it("outreach drafts reference verified observations only", async () => {
    const { ws, owner, b } = await setup();
    const audit = await db.websiteAudit.create({ data: { workspaceId: ws.id, businessId: b.id, status: "COMPLETED", classification: "NO_WEBSITE", findings: { create: [{ category: "functionality", severity: "CRITICAL", kind: "VERIFIED", code: "site.none", title: "No website", detail: "x" }] } } });
    expect(audit).toBeTruthy();
    const r = await generateOutreachDraft(ws.id, b.id, owner.id);
    expect(r.draft.bodyText).toContain("I couldn't find a website for ABC Cleaning");
    expect(r.draft.bodyText).not.toMatch(/\{\{/);
    expect(r.draft.status).toBe("DRAFT");
  });
});
