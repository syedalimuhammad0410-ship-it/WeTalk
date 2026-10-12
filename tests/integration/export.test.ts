import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { exportCsv, loadExportLeads } from "@/lib/server/export";
import { buildLeadsPdf, DEFAULT_PDF_SECTIONS } from "@/lib/server/export-pdf";
import { makeWorkspace } from "../helpers";

async function seed() {
  const { ws } = await makeWorkspace();
  const a = await db.business.create({ data: { workspaceId: ws.id, name: "Maple Dental — Café & Spa", normalizedName: "maple dental", city: "Mississauga", phone: "905-555-0100", email: "hi@maple.test", website: "https://maple.test", websiteStatus: "WEBSITE_FOUND", websiteClass: "OUTDATED", websiteScore: 38, opportunityScore: 82, businessType: "dental" } });
  await db.business.create({ data: { workspaceId: ws.id, name: "=SUM(A1)", normalizedName: "sum", city: "Toronto", websiteStatus: "NO_WEBSITE", opportunityScore: 60 } });
  const audit = await db.websiteAudit.create({ data: { workspaceId: ws.id, businessId: a.id, status: "COMPLETED", summary: "Outdated site without online booking.", overallScore: 38 } });
  await db.websiteFinding.create({ data: { auditId: audit.id, category: "conversion", severity: "HIGH", kind: "issue", code: "conv.booking", title: "No online booking", detail: "Patients must call to book." } });
  await db.opportunity.create({ data: { workspaceId: ws.id, businessId: a.id, auditId: audit.id, score: 82, businessType: "dental", summary: "High", reasons: [{ label: "Outdated website", points: 30, kind: "VERIFIED" }], recommendedFeatures: [{ name: "Online booking", priority: "essential", status: "missing" }] } });
  await db.note.create({ data: { workspaceId: ws.id, businessId: a.id, body: "Owner prefers email → follow up Tuesday ✓" } });
  return { ws, a };
}

describe("custom lead export", () => {
  it("exports only the chosen columns, in order, with an Excel BOM and formula protection", async () => {
    const { ws } = await seed();
    const { csv, count } = await exportCsv(ws.id, { columns: ["name", "city", "opportunityScore", "topIssues", "missingFeatures"] });
    expect(count).toBe(2);
    expect(csv.startsWith("﻿Business,City,Opportunity score,Top website issues,Features they're missing\r\n")).toBe(true);
    expect(csv).toContain("Maple Dental — Café & Spa,Mississauga,82,No online booking,Online booking");
    expect(csv).toContain("'=SUM(A1)");
  });

  it("builds a multi-page PDF report with summary and lead details", async () => {
    const { ws } = await seed();
    const { leads, total } = await loadExportLeads(ws.id, { columns: [] }, 300);
    const pdf = await buildLeadsPdf({ leads, total, agency: "Naqvi Helpers", title: "Lead report", scope: "All leads", sections: DEFAULT_PDF_SECTIONS });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(leads[0]!.name).toContain("Maple"); // highest opportunity first
  });

  it("keeps summary breakdowns together and makes websites, emails and leads clickable", async () => {
    const { ws } = await seed();
    const cities = ["Brampton", "Oakville", "Milton", "Burlington", "Vaughan", "Markham", "Pickering", "Ajax"];
    const types = ["plumber", "roofer", "electrician", "landscaper", "salon", "restaurant", "auto_repair", "cleaning"];
    for (let i = 0; i < 16; i++) {
      await db.business.create({ data: { workspaceId: ws.id, name: `Biz ${i}`, normalizedName: `biz ${i}`, city: cities[i % 8], businessType: types[i % 8], website: i % 2 ? `biz${i}.test` : null, websiteStatus: i % 2 ? "WEBSITE_FOUND" : "NO_WEBSITE", opportunityScore: 40 + i } });
    }
    const { leads, total } = await loadExportLeads(ws.id, { columns: [] }, 300);
    const summaryOnly = { summary: true, contact: false, audit: false, opportunity: false, outreach: false, notes: false };
    const pdf = await buildLeadsPdf({ leads, total, agency: "Naqvi Helpers", title: "Lead report", scope: "All leads", sections: summaryOnly });
    const raw = pdf.toString("latin1");
    // Each breakdown pair lands whole on a page: one page, or two when the second pair moves over in full.
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBeLessThanOrEqual(2);

    const full = (await buildLeadsPdf({ leads, total, agency: "Naqvi Helpers", title: "Lead report", scope: "All leads", sections: DEFAULT_PDF_SECTIONS })).toString("latin1");
    expect(full).toContain("(https://maple.test)");
    expect(full).toContain("(https://biz1.test)"); // bare domains become https links
    expect(full).toContain("(mailto:hi@maple.test)");
    expect(full).toMatch(/\/leads\/[\w-]+\)/); // each lead links back to WebScout
  });
});
