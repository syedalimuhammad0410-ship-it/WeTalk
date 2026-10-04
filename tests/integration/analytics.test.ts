import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { analytics, dashboardStats, exportLeadsCsv, listLeads, LeadFilters } from "@/lib/server/queries";
import { campaignStats } from "@/lib/server/campaigns";
import { changeLeadStatus } from "@/lib/server/leads";
import { makeWorkspace } from "../helpers";

describe("analytics, dashboard, filters & export come from the database", () => {
  it("computes rates from real records", async () => {
    const { ws, owner } = await makeWorkspace();
    const mk = (i: number, extra = {}) => db.business.create({ data: { workspaceId: ws.id, name: `B${i}`, normalizedName: `b${i}`, city: i % 2 ? "Toronto" : "Mississauga", opportunityScore: i * 20, businessType: "restaurant", ...extra } });
    const bs = await Promise.all([1, 2, 3, 4].map((i) => mk(i)));
    const camp = await db.campaign.create({ data: { workspaceId: ws.id, name: "C1" } });
    for (const b of bs.slice(0, 2)) {
      await db.campaignLead.create({ data: { campaignId: camp.id, businessId: b.id } });
      const conv = await db.conversation.create({ data: { workspaceId: ws.id, businessId: b.id, subject: "s", counterpartEmail: `${b.id}@x.test` } });
      await db.emailMessage.create({ data: { workspaceId: ws.id, businessId: b.id, conversationId: conv.id, campaignId: camp.id, direction: "OUTBOUND", status: "SENT", kind: "OUTREACH", fromAddress: "a", toAddress: "b", subject: "s", bodyText: "x", sentAt: new Date(Date.now() - 7200_000) } });
    }
    const conv = await db.conversation.findFirstOrThrow({ where: { businessId: bs[0]!.id } });
    await db.emailMessage.create({ data: { workspaceId: ws.id, businessId: bs[0]!.id, conversationId: conv.id, direction: "INBOUND", status: "RECEIVED", kind: "INBOUND", fromAddress: "b", toAddress: "a", subject: "re", bodyText: "yes", intent: "INTERESTED", receivedAt: new Date(Date.now() - 3600_000) } });
    await db.business.update({ where: { id: bs[0]!.id }, data: { lastResponseAt: new Date(), lastContactedAt: new Date() } });
    await changeLeadStatus({ workspaceId: ws.id, businessId: bs[0]!.id, to: "MEETING", userId: owner.id });
    await changeLeadStatus({ workspaceId: ws.id, businessId: bs[0]!.id, to: "WON", userId: owner.id });
    const a = await analytics(ws.id, new Date(Date.now() - 86400_000 * 2), new Date());
    expect(a.totals.contacted).toBe(2);
    expect(a.rates.responseRate).toBe(0.5);
    expect(a.rates.positiveResponseRate).toBe(0.5);
    expect(a.rates.meetingRate).toBe(0.5);
    expect(a.rates.conversionRate).toBe(0.5);
    expect(a.rates.avgResponseHours).toBeCloseTo(1, 0);
    expect(a.rates.websiteOpportunityRate).toBe(0.25); // scores 20/40/60/80 → only 80 is ≥ 70
    const d = await dashboardStats(ws.id);
    expect(d).toMatchObject({ businesses: 4, sent: 2, responses: 1, customers: 1, meetings: 1 });
    const cs = await campaignStats(ws.id, camp.id);
    expect(cs).toMatchObject({ found: 2, contacted: 2, responses: 1, won: 1 });
    const filtered = await listLeads(ws.id, LeadFilters.parse({ city: "Toronto", minOpportunity: "50" }));
    expect(filtered.rows.map((r) => r.name)).toEqual(["B3"]);
    const { csv } = await exportLeadsCsv(ws.id, {});
    expect(csv.split("\r\n")[0]).toBe("Business,Category,Address,Phone,Website,Email,Website Status,Website Score,Opportunity Score,Lead Status,Response Status,Campaign,Date Added");
    expect(csv).toContain("Responded");
  });

  it("neutralises spreadsheet formula injection in exports", async () => {
    const { ws } = await makeWorkspace();
    await db.business.create({ data: { workspaceId: ws.id, name: "=HYPERLINK(\"http://evil\")", normalizedName: "x" } });
    const { csv } = await exportLeadsCsv(ws.id, {});
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
