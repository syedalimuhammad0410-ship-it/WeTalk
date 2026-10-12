import { afterEach, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { runAssistant, runConfirmedAction } from "@/lib/server/assistant/agent";
import { setAiFactoryForTests } from "@/lib/server/ai/client";
import type { AuthContext } from "@/lib/server/auth";
import { fakeAi, makeWorkspace, addMember } from "../helpers";

const ctxFor = (ws: { id: string; name: string }, user: { id: string; email: string; name: string }, role: Role): AuthContext =>
  ({ user: { ...user, avatarUrl: null, isSystemAdmin: false, themePreference: "system" }, workspace: { id: ws.id, name: ws.name, slug: "x", isDemo: false, onboardingCompleted: true, onboardingStep: 5 }, role }) as AuthContext;

/** Scripted model: returns the next planned step each time it's called; records prompts. */
function scripted(steps: { say?: string; tool: string; args?: unknown }[]) {
  let i = 0;
  const calls = fakeAi({ assistant: () => { const s = steps[Math.min(i++, steps.length - 1)]!; return { say: s.say ?? "", tool: s.tool, args_json: JSON.stringify(s.args ?? {}) }; } });
  return calls;
}

async function setup() {
  const { ws, owner } = await makeWorkspace();
  const lead = await db.business.create({ data: { workspaceId: ws.id, name: "Maple Dental", normalizedName: "maple dental", city: "Mississauga", email: "hi@maple.test", opportunityScore: 88, websiteStatus: "NO_WEBSITE" } });
  return { ws, owner, lead };
}

describe("AI assistant", () => {
  afterEach(() => setAiFactoryForTests(null));

  it("uses tools to look things up and answers from real data", async () => {
    const { ws, owner, lead } = await setup();
    const calls = scripted([{ tool: "search_leads", args: { minOpportunity: 50 } }, { tool: "none", say: `Your best lead is [Maple Dental](/leads/${lead.id}).` }]);
    const r = await runAssistant(ctxFor(ws, owner, "OWNER"), [{ role: "user", content: "Who is my best lead?" }]);
    expect(r.steps).toEqual([{ tool: "search_leads", ok: true, summary: "Read" }]);
    expect(r.reply).toContain("Maple Dental");
    expect(r.changed).toBe(false);
    // The second model call saw the real tool result.
    expect(calls[1]!.prompt).toContain(lead.id);
  });

  it("runs safe actions directly and reports a change", async () => {
    const { ws, owner, lead } = await setup();
    scripted([{ tool: "add_note", args: { leadId: lead.id, text: "Called — interested" } }, { tool: "change_lead_status", args: { leadId: lead.id, status: "INTERESTED" } }, { tool: "none", say: "Noted and moved to Interested." }]);
    const r = await runAssistant(ctxFor(ws, owner, "OWNER"), [{ role: "user", content: "Note that Maple Dental is interested" }]);
    expect(r.changed).toBe(true);
    expect(await db.note.count({ where: { businessId: lead.id } })).toBe(1);
    expect((await db.business.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("INTERESTED");
  });

  it("never sends email by itself: it asks for confirmation, and only the confirm call sends", async () => {
    const { ws, owner, lead } = await setup();
    const draft = await db.emailMessage.create({ data: { workspaceId: ws.id, businessId: lead.id, direction: "OUTBOUND", status: "DRAFT", kind: "OUTREACH", fromAddress: "", toAddress: "hi@maple.test", subject: "quick note about Maple Dental", bodyText: "Hi there" } });
    scripted([{ tool: "send_email", args: { draftId: draft.id }, say: "Ready to send — please confirm." }]);
    const ctx = ctxFor(ws, owner, "OWNER");
    const r = await runAssistant(ctx, [{ role: "user", content: "Send it" }]);
    expect(r.pending).toMatchObject({ tool: "send_email", summary: expect.stringContaining("hi@maple.test") });
    expect((await db.emailMessage.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    await runConfirmedAction(ctx, r.pending!);
    expect(await db.emailMessage.count({ where: { workspaceId: ws.id, direction: "OUTBOUND", status: "SENT" } })).toBe(1);
  });

  it("respects the user's role and recovers from bad tool calls", async () => {
    const { ws, lead } = await setup();
    const viewer = await addMember(ws.id, "VIEWER");
    scripted([{ tool: "add_note", args: { leadId: lead.id, text: "x" } }, { tool: "search_leads", args: { limit: 999 } }, { tool: "none", say: "Sorry, you can't edit leads." }]);
    const r = await runAssistant(ctxFor(ws, viewer, "VIEWER"), [{ role: "user", content: "Add a note" }]);
    expect(r.steps[0]).toMatchObject({ tool: "add_note", ok: false, summary: expect.stringMatching(/does not allow/) });
    expect(r.steps[1]).toMatchObject({ tool: "search_leads", ok: false, summary: expect.stringMatching(/Invalid arguments/) });
    expect(await db.note.count({ where: { businessId: lead.id } })).toBe(0);
    await expect(runConfirmedAction(ctxFor(ws, viewer, "VIEWER"), { tool: "mark_do_not_contact", args: { leadId: lead.id } })).rejects.toThrow(/does not allow/);
  });
});
