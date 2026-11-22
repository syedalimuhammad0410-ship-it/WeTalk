import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { controlEmailRun, createEmailRun, emailAudience, emailRunState, runEmailRunSlice, typeGroup } from "@/lib/server/email/runs";
import { fakeAi, makeWorkspace } from "../helpers";

async function lead(ws: string, name: string, email: string, eligibility: string, extra: Record<string, unknown> = {}) {
  const b = await db.business.create({ data: { workspaceId: ws, name, normalizedName: name.toLowerCase(), city: "Mississauga", category: "Bakery", businessType: "bakery", email, website: `https://${name.replace(/\W/g, "").toLowerCase()}.test`, websiteDomain: `${name.replace(/\W/g, "").toLowerCase()}.test`, ...extra } });
  await db.contact.create({ data: { workspaceId: ws, businessId: b.id, email, source: "test", classification: "VERIFIED_PUBLIC", eligibility } });
  return b;
}

async function setup() {
  const { ws, owner } = await makeWorkspace();
  await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { physicalAddress: "1 King St W, Toronto, ON M5H 1A1" } });
  return { ws, owner };
}

describe("email runs (Emails page)", () => {
  const calls: { feature: string; prompt: string }[] = [];
  beforeEach(() => {
    calls.length = 0;
    fakeAi({ outreach_generation: (p) => ({ subject: p.includes("none — write a general introduction") ? "Hello from Studio" : "quick note about your site", body: "Hi there,\n\nA short, honest note.\n\nAlex, Studio" }) }, calls);
  });

  it("emails only cleared, not-yet-emailed leads one by one and records the prompt for each", async () => {
    const { ws, owner } = await setup();
    const withAudit = await lead(ws.id, "Bonanza Bakery", "info@bonanza.test", "ELIGIBLE");
    await db.websiteAudit.create({ data: { workspaceId: ws.id, businessId: withAudit.id, status: "COMPLETED", classification: "MODERN", findings: { create: [{ category: "conversion", severity: "HIGH", kind: "VERIFIED", code: "feature.missing.click_to_call", title: "No tap-to-call", detail: "No tel: link" }] } } });
    const plain = await lead(ws.id, "Cafe Two", "hello@cafetwo.test", "ELIGIBLE");
    const review = await lead(ws.id, "Review Co", "owner@review.test", "NEEDS_REVIEW");
    const blocked = await lead(ws.id, "Blocked Co", "billing@blocked.test", "INELIGIBLE");
    const dupe = await lead(ws.id, "Cafe Two Annex", "hello@cafetwo.test", "ELIGIBLE");

    const audience = await emailAudience(ws.id);
    expect(audience.find((l) => l.id === review.id)?.eligibility).toBe("NEEDS_REVIEW");

    const { run, excluded } = await createEmailRun(ws.id, owner.id, { businessIds: [withAudit.id, plain.id, review.id, blocked.id, dupe.id], useAi: true, includeNeedsReview: false });
    expect(run.total).toBe(2);
    expect(excluded).toMatchObject({ needsReview: 1, notCleared: 1, duplicateAddress: 1 });

    await runEmailRunSlice(run.id);
    const s = await emailRunState(ws.id, run.id);
    expect(s.run.status).toBe("COMPLETED");
    expect(s.run.sent).toBe(2);
    expect(s.run.left).toBe(0);

    const items = await db.emailRunItem.findMany({ where: { runId: run.id }, orderBy: { position: "asc" } });
    expect(items.map((i) => i.status)).toEqual(["SENT", "SENT"]);
    expect(items[0]!.prompt).toContain("VERIFIED OBSERVATIONS");
    expect(items[0]!.prompt).toContain("tap to call");
    expect(items[1]!.prompt).toContain("none — write a general introduction");
    expect(items[1]!.subject).toBe("Hello from Studio");
    expect(s.run.instructions).toBeTruthy();

    const sent = await db.emailMessage.findMany({ where: { workspaceId: ws.id, direction: "OUTBOUND", status: "SENT" } });
    expect(sent).toHaveLength(2);
    for (const m of sent) {
      expect(m.bodyText).toContain("1 King St W, Toronto");
      expect(m.bodyText.toLowerCase()).toContain("unsubscribe");
    }
    expect((await db.business.findUnique({ where: { id: plain.id } }))?.status).toBe("CONTACTED");

    // Already emailed: a second run finds nobody left to email.
    await expect(createEmailRun(ws.id, owner.id, { businessIds: [withAudit.id, plain.id], useAi: true, includeNeedsReview: false })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses to start without a mailing address or a working email account", async () => {
    const { ws, owner } = await makeWorkspace();
    const b = await lead(ws.id, "Some Bakery", "info@some.test", "ELIGIBLE");
    await expect(createEmailRun(ws.id, owner.id, { businessIds: [b.id], useAi: true, includeNeedsReview: false })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { physicalAddress: "1 King St W, Toronto" } });
    await db.emailAccount.updateMany({ where: { workspaceId: ws.id }, data: { status: "ERROR", lastError: "token revoked" } });
    await expect(createEmailRun(ws.id, owner.id, { businessIds: [b.id], useAi: true, includeNeedsReview: false })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("waits for the next send slot instead of breaking the spacing limit, and can be paused, resumed and cancelled", async () => {
    const { ws, owner } = await setup();
    await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { minMinutesBetweenSends: 2 } });
    const a = await lead(ws.id, "First Bakery", "a@first.test", "ELIGIBLE");
    const b = await lead(ws.id, "Second Bakery", "b@second.test", "ELIGIBLE");
    const { run } = await createEmailRun(ws.id, owner.id, { businessIds: [a.id, b.id], useAi: false, includeNeedsReview: false });

    await runEmailRunSlice(run.id);
    let s = await emailRunState(ws.id, run.id);
    expect(s.run.sent).toBe(1);
    expect(s.run.status).toBe("RUNNING");
    expect(new Date(s.run.nextSendAt!).getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(s.run.message).toContain("between emails");
    expect(calls).toHaveLength(0); // useAi: false → no AI calls

    s = await controlEmailRun(ws.id, run.id, "pause");
    expect(s.run.status).toBe("PAUSED");
    expect((await runEmailRunSlice(run.id)).message).toContain("paused");
    s = await controlEmailRun(ws.id, run.id, "resume");
    expect(s.run.status).toBe("RUNNING");
    s = await controlEmailRun(ws.id, run.id, "cancel");
    expect(s.run.status).toBe("CANCELLED");
    expect(s.run.sent).toBe(1);
  });

  it("groups business types for the filters", () => {
    expect(typeGroup("Italian restaurant")).toBe("food");
    expect(typeGroup("Bakery Cafe")).toBe("bakery");
    expect(typeGroup("Auto repair shop")).toBe("auto");
    expect(typeGroup("Bridal shop")).toBe("retail");
    expect(typeGroup("Physiotherapy Center")).toBe("health");
    expect(typeGroup("Barbershop")).toBe("beauty");
    expect(typeGroup("company")).toBe("other");
  });
});
