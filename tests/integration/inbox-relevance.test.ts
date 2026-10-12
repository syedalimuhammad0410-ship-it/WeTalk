import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestInbound } from "@/lib/server/email/inbound";
import type { InboundEmail } from "@/lib/server/email/providers";
import { categorizeEmail, cleanupInbox, ruleRelevance } from "@/lib/server/email/relevance";
import { categoryCounts, inboxWhere, parseInboxFilters, sectionCounts } from "@/lib/server/inbox";
import { setConversationControl } from "@/lib/server/replies/actions";
import { setAiFactoryForTests } from "@/lib/server/ai/client";
import { fakeAi, makeWorkspace, noAi } from "../helpers";

let seq = 0;
const mail = (from: string, subject: string, text: string, extra: Partial<InboundEmail> = {}): InboundEmail => ({
  providerMessageId: `rel-${Date.now()}-${++seq}`, rfcMessageId: `<rel-${seq}@x.test>`, inReplyTo: null, references: null, providerThreadId: null,
  from, fromName: null, to: "agency@studio.test", subject, text, html: null, receivedAt: new Date(), ...extra,
});
const company = { companyName: "Studio", senderName: "Alex Rivera" };

describe("rule signals", () => {
  it("files obvious noise and keeps obvious agency mail", () => {
    expect(ruleRelevance(mail("news@shop.test", "Fall sale", "Big savings", { isBulk: true }), company)).toMatchObject({ related: false });
    expect(ruleRelevance(mail("no-reply@bank.test", "Statement ready", "Log in to view"), company)).toMatchObject({ related: false });
    expect(ruleRelevance(mail("ana@gmail.test", "Your order confirmation", "Order #123 has shipped"), company)).toMatchObject({ related: false });
    expect(ruleRelevance(mail("owner@bakery.test", "Hello", "Hi Alex Rivera, saw your note"), company)).toMatchObject({ related: true });
    expect(ruleRelevance(mail("owner@bakery.test", "Re: quick note", "Yes we'd like a new website"), company)).toMatchObject({ related: true });
    expect(ruleRelevance(mail("someone@corp.test", "Question", "Can you call me?"), company)).toBeNull();
  });
});

describe("inbound filtering", () => {
  afterEach(() => setAiFactoryForTests(null));

  async function setup() {
    const { ws } = await makeWorkspace();
    const account = (await db.emailAccount.findFirst({ where: { workspaceId: ws.id } }))!;
    return { ws, account };
  }

  it("newsletters go to Filtered: no analysis job, hidden from inbox sections", async () => {
    noAi();
    const { ws, account } = await setup();
    const r = await ingestInbound(account, mail("news@deals.test", "This week's deals", "Shop now", { isBulk: true }));
    expect(r).toMatchObject({ filtered: true });
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: r!.conversationId! } });
    expect(conv).toMatchObject({ filtered: true, isOpen: false, unread: false, needsHumanReview: false });
    expect(await db.job.count({ where: { workspaceId: ws.id, type: "INBOUND_ANALYSIS" } })).toBe(0);
    const counts = await sectionCounts(ws.id);
    expect(counts.all).toBe(0);
    expect(counts.filtered).toBe(1);
    // A second email from the same sender stays filtered too.
    const r2 = await ingestInbound(account, mail("news@deals.test", "More deals", "Shop again"));
    expect(r2).toMatchObject({ filtered: true, conversationId: r!.conversationId });
  });

  it("keeps mail from people or companies we emailed before, even in a new thread", async () => {
    noAi();
    const { ws, account } = await setup();
    await db.emailMessage.create({ data: { workspaceId: ws.id, direction: "OUTBOUND", status: "SENT", kind: "OUTREACH", fromAddress: "agency@studio.test", toAddress: "info@acme-plumbing.test", subject: "quick note", bodyText: "hi", sentAt: new Date() } });
    const r = await ingestInbound(account, mail("dave@acme-plumbing.test", "Following up", "Saw the email you sent our office."));
    expect(r).toMatchObject({ filtered: false });
    const msg = await db.emailMessage.findUniqueOrThrow({ where: { id: r!.messageId } });
    expect((msg.analysis as { relevance: { method: string } }).relevance.method).toBe("prior_contact");
  });

  it("uses the AI for unclear emails and only hides confident 'not related' verdicts", async () => {
    const { account } = await setup();
    const calls = fakeAi({ inbound_relevance: () => ({ related: false, category: "cold_pitch_to_us", confidence: 92, reason: "Offers to sell us SEO leads" }) });
    const sold = await ingestInbound(account, mail("rep@leadgen.test", "Partnership", "We can send you 500 leads a month."));
    expect(sold).toMatchObject({ filtered: true });
    expect(calls[0]!.prompt).toContain("From: rep@leadgen.test");
    fakeAi({ inbound_relevance: () => ({ related: false, category: "other", confidence: 40, reason: "Unclear" }) });
    expect(await ingestInbound(account, mail("maybe@corp.test", "Question", "Can you call me?"))).toMatchObject({ filtered: false });
    fakeAi({ inbound_relevance: () => ({ related: true, category: "new_enquiry", confidence: 88, reason: "Asks for a booking site" }) });
    expect(await ingestInbound(account, mail("spa@corp.test", "Hi", "We need online booking for our spa."))).toMatchObject({ filtered: false });
  });

  it("team members can mark not related or move back to the inbox; clean-up files old noise", async () => {
    noAi();
    const { ws, account, } = await setup();
    const owner = (await db.workspaceMember.findFirst({ where: { workspaceId: ws.id } }))!.userId;
    const keep = await ingestInbound(account, mail("person@corp.test", "Question", "Can you call me?"));
    expect(keep).toMatchObject({ filtered: false });
    await setConversationControl(ws.id, keep!.conversationId!, owner, "FILTER");
    expect((await sectionCounts(ws.id)).filtered).toBe(1);
    await setConversationControl(ws.id, keep!.conversationId!, owner, "UNFILTER");
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: keep!.conversationId! } });
    expect(conv).toMatchObject({ filtered: false, isOpen: true, needsHumanReview: true });
    expect(await db.job.count({ where: { workspaceId: ws.id, type: "INBOUND_ANALYSIS" } })).toBeGreaterThan(0);

    // An old unmatched conversation that is clearly a notification gets filed by the clean-up.
    const old = await db.conversation.create({ data: { workspaceId: ws.id, subject: "Security alert", counterpartEmail: "alerts@bank.test", needsHumanReview: true } });
    await db.emailMessage.create({ data: { workspaceId: ws.id, conversationId: old.id, direction: "INBOUND", status: "RECEIVED", kind: "INBOUND", fromAddress: "alerts@bank.test", toAddress: "agency@studio.test", subject: "Security alert", bodyText: "New sign-in to your account" } });
    const res = await cleanupInbox(ws.id);
    expect(res.filtered).toBe(1);
    expect(await db.conversation.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ filtered: true, needsHumanReview: false });
    expect(await db.conversation.findUniqueOrThrow({ where: { id: keep!.conversationId! } })).toMatchObject({ filtered: false });
  });
});

describe("email categories and inbox filters", () => {
  afterEach(() => setAiFactoryForTests(null));

  it("categorises common email types", () => {
    expect(categorizeEmail(mail("no-reply@app.test", "Your code", "123456 is your verification code"))).toBe("verification_code");
    expect(categorizeEmail(mail("hello@tool.test", "Please confirm your email", "Click to verify your email address"))).toBe("confirmation");
    expect(categorizeEmail(mail("security@bank.test", "New sign-in", "We noticed a new sign-in to your account"))).toBe("security_alert");
    expect(categorizeEmail(mail("orders@shop.test", "Order #4412 has shipped", "Tracking inside"))).toBe("receipt_order");
    expect(categorizeEmail(mail("news@brand.test", "October news", "Read more", { isBulk: true }))).toBe("newsletter_promo");
    expect(categorizeEmail(mail("owner@bakery.test", "Re: website", "Sounds good"), { linkedToLead: true })).toBe("lead_reply");
    expect(categorizeEmail(mail("rep@leads.test", "Leads", "We sell leads"), { relevance: { related: false, method: "ai", category: "cold_pitch_to_us", reason: "" } })).toBe("cold_pitch");
  });

  it("filters by type (including filtered email), people we contacted, linked leads and text", async () => {
    noAi();
    const { ws } = await makeWorkspace();
    const account = (await db.emailAccount.findFirst({ where: { workspaceId: ws.id } }))!;
    const code = await ingestInbound(account, mail("no-reply@app.test", "Your login code", "482913 is your verification code"));
    expect(code).toMatchObject({ filtered: true });
    const contacted = await db.conversation.create({ data: { workspaceId: ws.id, subject: "quick note", counterpartEmail: "owner@salon.test", category: "lead_reply" } });
    await db.emailMessage.create({ data: { workspaceId: ws.id, conversationId: contacted.id, direction: "OUTBOUND", status: "SENT", kind: "OUTREACH", fromAddress: "agency@studio.test", toAddress: "owner@salon.test", subject: "quick note", bodyText: "Hi there, about your salon website" } });

    const find = (sp: Record<string, string>, section: "all" | "filtered" = "all") => db.conversation.findMany({ where: inboxWhere(ws.id, section, parseInboxFilters(sp)), select: { id: true } });
    expect((await find({})).map((c) => c.id)).not.toContain(code!.conversationId);
    expect((await find({ cat: "verification_code" })).map((c) => c.id)).toEqual([code!.conversationId]);
    expect((await find({ contacted: "1" })).map((c) => c.id)).toEqual([contacted.id]);
    expect((await find({ q: "salon website" })).map((c) => c.id)).toEqual([contacted.id]);
    expect(await find({ cat: "not-a-real-type" })).toHaveLength((await find({})).length);
    const counts = await categoryCounts(ws.id);
    expect(counts).toMatchObject({ contacted: 1, byCategory: { verification_code: 1, lead_reply: 1 } });
  });
});
