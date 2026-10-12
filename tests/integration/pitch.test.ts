import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildCallScript, generateQuote } from "@/lib/server/pitch";
import { fakeAi, makeWorkspace, noAi } from "../helpers";

const PRICING = "Essential website $400. Growth website $700. Complete website $1,000 (maximum). Basic Care $25/month.";

describe("pitch & quote", () => {
  it("builds a call script from the lead and agency profile without AI", async () => {
    noAi();
    const { ws } = await makeWorkspace({ company: { companyName: "Naqvi Helpers", senderName: "Ali Naqvi" } });
    const b = await db.business.create({ data: { workspaceId: ws.id, name: "Joe's Plumbing", normalizedName: "joes plumbing", city: "Mississauga", phone: "905-555-0100", businessType: "plumber" } });
    const s = await buildCallScript(ws.id, b.id);
    expect(s.opener).toContain("Joe's Plumbing");
    expect(s.opener).toContain("Ali from Naqvi Helpers");
    expect(s.askForEmail).toBe(true);
    expect(s.noAudit).toBe(true);
    expect(s.questions.length).toBeGreaterThan(1);
  });

  it("quotes only configured prices and flags anything else", async () => {
    const { ws } = await makeWorkspace({ company: { pricingEnabled: true, pricingDetails: PRICING } });
    const b = await db.business.create({ data: { workspaceId: ws.id, name: "Bella Cucina", normalizedName: "bella cucina", businessType: "restaurant" } });
    fakeAi({ quote: () => ({ package_name: "Growth website", price: "$700", why: "Menu and online ordering.", included: ["Menu page", "Online ordering link"], add_ons: [], care_plan: "Basic Care $25/month", terms: "", questions: ["Do you take reservations?"] }) });
    const ok = await generateQuote(ws.id, b.id, "menu and online ordering");
    expect(ok.text).toContain("Growth website — $700");
    expect(ok.issues).toEqual([]);
    fakeAi({ quote: () => ({ package_name: "Growth website", price: "$650", why: "x", included: [], add_ons: [], care_plan: "", terms: "", questions: [] }) });
    const bad = await generateQuote(ws.id, b.id, "");
    expect(bad.issues.join(" ")).toMatch(/\$650/);
  });

  it("explains what's missing when pricing isn't configured", async () => {
    const { ws } = await makeWorkspace({ company: { pricingEnabled: false, pricingDetails: "" } });
    const b = await db.business.create({ data: { workspaceId: ws.id, name: "X", normalizedName: "x" } });
    await expect(generateQuote(ws.id, b.id, "")).rejects.toThrow(/Add your prices/);
  });
});
