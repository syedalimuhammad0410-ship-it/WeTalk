import * as z from "zod";
import { NextResponse } from "next/server";
import { api, parseBody } from "@/lib/server/api";
import { LeadFilters } from "@/lib/server/queries";
import { exportCsv, loadExportLeads } from "@/lib/server/export";
import { buildLeadsPdf, DEFAULT_PDF_SECTIONS } from "@/lib/server/export-pdf";
import { getSettings } from "@/lib/server/workspace";
import { logActivity } from "@/lib/server/activity";
import { AppError } from "@/lib/server/errors";
import { EXPORT_COLUMNS, type ExportColumnId } from "@/lib/export-columns";

export const maxDuration = 300;

const PDF_LIMIT = 300;
const Body = z.object({
  format: z.enum(["csv", "pdf"]),
  scope: z.enum(["filters", "selected", "all"]),
  filters: LeadFilters.partial().optional(),
  ids: z.array(z.string()).max(5000).optional(),
  columns: z.array(z.string()).max(60).default([]),
  sections: z.object({ summary: z.boolean(), contact: z.boolean(), audit: z.boolean(), opportunity: z.boolean(), outreach: z.boolean(), notes: z.boolean() }).partial().optional(),
  title: z.string().trim().max(120).optional(),
});

/** Custom lead export: chosen columns as CSV, or a detailed PDF report. */
export const POST = api({ permission: "leads.export" }, async (req, ctx) => {
  const b = await parseBody(req, Body);
  if (b.scope === "selected" && !b.ids?.length) throw new AppError("VALIDATION", "Select at least one lead, or export by filters.");
  const request = {
    filters: b.scope === "filters" ? b.filters ?? {} : {},
    ids: b.scope === "selected" ? b.ids : undefined,
    columns: b.columns.filter((c): c is ExportColumnId => EXPORT_COLUMNS.some((x) => x.id === c)),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  if (b.format === "csv") {
    const { csv, count } = await exportCsv(ctx.workspace.id, request);
    await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "leads.exported", summary: `Exported ${count} leads to CSV (${request.columns.length} columns)` });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="webscout-leads-${stamp}.csv"`, "Cache-Control": "no-store" } });
  }
  const { leads, total } = await loadExportLeads(ctx.workspace.id, request, PDF_LIMIT);
  if (!leads.length) throw new AppError("NOT_FOUND", "No leads match this export.");
  const { company } = await getSettings(ctx.workspace.id);
  const f = request.filters as Record<string, unknown>;
  const scope = b.scope === "selected" ? `Selected leads` : b.scope === "all" || !Object.keys(f).length ? "All leads" : `Filters: ${Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== null).map(([k, v]) => `${k} = ${String(v)}`).join(", ")}`;
  const pdf = await buildLeadsPdf({ leads, total, agency: company.companyName, title: b.title || "Lead report", scope, sections: { ...DEFAULT_PDF_SECTIONS, ...b.sections } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "leads.exported", summary: `Exported a PDF report of ${leads.length} leads` });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="webscout-lead-report-${stamp}.pdf"`, "Cache-Control": "no-store" } });
});
