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
});
