import "./guard";
import ExcelJS from "exceljs";
import { env } from "./env";
import { getPlaybook } from "./intel/playbooks";
import { columnValue, human, leadDescription, leadServices, leadSocials, type ExportLead } from "./export";
import { webLink } from "./export-pdf";
import { EXPORT_COLUMNS, type ExportColumnId } from "../export-columns";

const ACCENT = "FF4F46E5";
const SOFT = "FFEEF2FF";
const ZEBRA = "FFF9FAFB";
const LINE = "FFE5E7EB";
const MUTED = "FF6B7280";
const GOOD = { fill: "FFD1FAE5", font: "FF065F46" };
const WARN = { fill: "FFFEF3C7", font: "FF92400E" };
const BAD = { fill: "FFFEE2E2", font: "FF991B1B" };

/** Column widths (characters) and whether the column holds long text that should wrap. */
const LAYOUT: Partial<Record<ExportColumnId, { width: number; wrap?: boolean }>> = {
  name: { width: 30 }, description: { width: 60, wrap: true }, services: { width: 40, wrap: true }, type: { width: 22 }, category: { width: 22 },
  address: { width: 38, wrap: true }, phone: { width: 17 }, email: { width: 30 }, website: { width: 32 }, googleMapsUrl: { width: 18 }, socials: { width: 34, wrap: true },
  hours: { width: 44, wrap: true }, auditSummary: { width: 56, wrap: true }, topIssues: { width: 44, wrap: true }, opportunityReasons: { width: 44, wrap: true },
  missingFeatures: { width: 40, wrap: true }, latestNote: { width: 44, wrap: true }, campaigns: { width: 24, wrap: true }, tags: { width: 22, wrap: true },
};
const SCORE_COLUMNS = new Set<ExportColumnId>(["opportunityScore", "websiteScore", "leadScore", "promptQuality"]);
const NUMBER_COLUMNS = new Set<ExportColumnId>(["rating", "reviewCount", "emailsSent", ...SCORE_COLUMNS]);

/** Higher is better for every score column. */
function scoreTone(n: number) {
  return n >= 70 ? GOOD : n >= 45 ? WARN : BAD;
}
function link(id: ExportColumnId, l: ExportLead, leadUrl: string): string | undefined {
  switch (id) {
    case "name": return leadUrl;
    case "website": return webLink(l.website);
    case "email": return l.email ? `mailto:${l.email}` : undefined;
    case "phone": return l.phone ? `tel:${l.phone.replace(/[^\d+]/g, "")}` : undefined;
    case "googleMapsUrl": return l.googleMapsUrl ?? undefined;
    case "socials": return leadSocials(l)[0];
    default: return undefined;
  }
}

/**
 * A formatted Excel workbook: a "Leads" sheet with the chosen columns (title banner,
 * coloured scores, clickable links, wrapped descriptions, filters, frozen header),
 * a "Lead profiles" sheet with one readable block per business, and a "Summary" sheet.
 */
export async function buildLeadsXlsx(opts: { leads: ExportLead[]; columns: ExportColumnId[]; agency: string; title: string; scope: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.agency || "WebScout AI";
  wb.created = new Date();
  const appUrl = env.appUrl();
  const leadUrl = (l: ExportLead) => `${appUrl}/leads/${l.id}`;
  const generated = `${opts.agency || "WebScout AI"} · ${opts.scope} · ${opts.leads.length} lead${opts.leads.length === 1 ? "" : "s"} · generated ${new Date().toISOString().slice(0, 10)}`;
  const thin = { style: "thin" as const, color: { argb: LINE } };

  // ── Leads (table) ──
  const cols = opts.columns.length ? opts.columns : (["name", "type", "description", "phone", "email", "address", "website"] as ExportColumnId[]);
  const ws = wb.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 4, xSplit: 1 }], properties: { defaultRowHeight: 18 } });
  ws.columns = cols.map((c) => ({ key: c, width: LAYOUT[c]?.width ?? (NUMBER_COLUMNS.has(c) ? 13 : 18) }));
  const span = Math.max(cols.length, 1);
  ws.mergeCells(1, 1, 1, span);
  ws.getCell(1, 1).value = opts.title;
  ws.getCell(1, 1).font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
  ws.getCell(1, 1).alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 34;
  ws.mergeCells(2, 1, 2, span);
  ws.getCell(2, 1).value = generated;
  ws.getCell(2, 1).font = { size: 10, color: { argb: MUTED } };
  ws.getCell(2, 1).alignment = { indent: 1 };
  const header = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = EXPORT_COLUMNS.find((x) => x.id === c)!.label;
    cell.font = { bold: true, color: { argb: ACCENT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: ACCENT } } };
  });
  header.height = 24;

  opts.leads.forEach((l, r) => {
    const row = ws.getRow(5 + r);
    let lines = 1;
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const raw = columnValue(c, l);
      const value = raw === null || raw === undefined || raw === "" ? (NUMBER_COLUMNS.has(c) ? null : "—") : raw;
      const href = value !== "—" ? link(c, l, leadUrl(l)) : undefined;
      const display = c === "googleMapsUrl" && href ? "Open map" : value;
      cell.value = href && typeof display === "string" ? { text: display, hyperlink: href } : (display as string | number | null);
      cell.alignment = { vertical: "top", wrapText: !!LAYOUT[c]?.wrap };
      cell.border = { bottom: thin };
      if (r % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      if (href) cell.font = { color: { argb: ACCENT }, underline: c !== "name", bold: c === "name" };
      else if (c === "name") cell.font = { bold: true };
      if (SCORE_COLUMNS.has(c) && typeof raw === "number") {
        const t = scoreTone(raw);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: t.fill } };
        cell.font = { bold: true, color: { argb: t.font } };
        cell.alignment = { vertical: "top", horizontal: "center" };
      }
      if (c === "rating" && typeof raw === "number") cell.numFmt = "0.0";
      if (LAYOUT[c]?.wrap && typeof value === "string") lines = Math.max(lines, Math.min(8, Math.ceil(value.length / (LAYOUT[c]!.width * 1.1))));
    });
    row.height = Math.max(20, lines * 15 + 4);
  });
  if (opts.leads.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + opts.leads.length, column: cols.length } };

  // ── Lead profiles (one readable block per business) ──
  const pf = wb.addWorksheet("Lead profiles", { properties: { defaultRowHeight: 18 } });
  pf.columns = [{ width: 22 }, { width: 90 }];
  pf.mergeCells(1, 1, 1, 2);
  pf.getCell(1, 1).value = `${opts.title} — business profiles`;
  pf.getCell(1, 1).font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  pf.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
  pf.getCell(1, 1).alignment = { vertical: "middle", indent: 1 };
  pf.getRow(1).height = 34;
  let y = 3;
  for (const l of opts.leads) {
    pf.mergeCells(y, 1, y, 2);
    const title = pf.getCell(y, 1);
    title.value = { text: l.name, hyperlink: leadUrl(l) };
    title.font = { bold: true, size: 14, color: { argb: ACCENT } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    title.alignment = { vertical: "middle", indent: 1 };
    pf.getRow(y).height = 26;
    y++;
    const services = leadServices(l);
    const rows: [string, string | null | undefined, string | undefined][] = [
      ["Business type", `${getPlaybook(l.businessType).label}${l.category ? ` (${l.category})` : ""}`, undefined],
      ["What they do", leadDescription(l), undefined],
      ["Services", services.length ? services.join(", ") : null, undefined],
      ["Address", l.address, undefined],
      ["Phone", l.phone, l.phone ? `tel:${l.phone.replace(/[^\d+]/g, "")}` : undefined],
      ["Email", l.email, l.email ? `mailto:${l.email}` : undefined],
      ["Website", l.website ?? "No website", webLink(l.website)],
      ["Google Maps", l.googleMapsUrl ? "Open in Google Maps" : null, l.googleMapsUrl ?? undefined],
      ["Social media", leadSocials(l).join(", ") || null, leadSocials(l)[0]],
      ["Google rating", l.rating != null ? `${l.rating.toFixed(1)} / 5 from ${l.reviewCount ?? 0} reviews` : null, undefined],
      ["Opening hours", l.hours.length ? l.hours.join("\n") : null, undefined],
      ["Website check", `${human(l.websiteClass ?? l.websiteStatus) || "Not checked"}${l.websiteScore != null ? ` — ${l.websiteScore}/100` : ""}`, undefined],
      ["Opportunity", l.opportunityScore != null ? `${l.opportunityScore}/100` : null, undefined],
      ["Lead status", human(l.status), undefined],
    ];
    for (const [label, value, href] of rows) {
      if (!value) continue;
      const a = pf.getCell(y, 1);
      const b = pf.getCell(y, 2);
      a.value = label;
      a.font = { bold: true, color: { argb: MUTED } };
      a.alignment = { vertical: "top", indent: 1 };
      b.value = href ? { text: value, hyperlink: href } : value;
      b.alignment = { vertical: "top", wrapText: true };
      if (href) b.font = { color: { argb: ACCENT }, underline: true };
      if (label === "Opportunity" && l.opportunityScore != null) {
        const t = scoreTone(l.opportunityScore);
        b.font = { bold: true, color: { argb: t.font } };
      }
      pf.getRow(y).height = Math.max(18, Math.min(10, Math.ceil(value.length / 95) + (value.match(/\n/g)?.length ?? 0)) * 15 + 3);
      y++;
    }
    y++;
  }

  // ── Summary ──
  const sm = wb.addWorksheet("Summary");
  sm.columns = [{ width: 34 }, { width: 12 }, { width: 4 }, { width: 34 }, { width: 12 }];
  sm.mergeCells(1, 1, 1, 5);
  sm.getCell(1, 1).value = `${opts.title} — summary`;
  sm.getCell(1, 1).font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  sm.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
  sm.getCell(1, 1).alignment = { vertical: "middle", indent: 1 };
  sm.getRow(1).height = 34;
  sm.getCell(2, 1).value = generated;
  sm.getCell(2, 1).font = { size: 10, color: { argb: MUTED } };
  const scored = opts.leads.filter((l) => l.opportunityScore != null);
  const stats: [string, number | string][] = [
    ["Leads", opts.leads.length],
    ["Average opportunity score", scored.length ? Math.round(scored.reduce((s, l) => s + l.opportunityScore!, 0) / scored.length) : "—"],
    ["No working website", opts.leads.filter((l) => ["NO_WEBSITE", "WEBSITE_UNAVAILABLE"].includes(l.websiteStatus) || l.websiteClass === "BROKEN").length],
    ["With an email address", opts.leads.filter((l) => l.email).length],
    ["With a phone number", opts.leads.filter((l) => l.phone).length],
    ["Contacted", opts.leads.filter((l) => l.lastContactedAt).length],
    ["Responded", opts.leads.filter((l) => l.lastResponseAt).length],
  ];
  stats.forEach(([k, v], i) => {
    sm.getCell(4 + i, 1).value = k;
    sm.getCell(4 + i, 2).value = v;
    sm.getCell(4 + i, 2).font = { bold: true, size: 12, color: { argb: ACCENT } };
    sm.getCell(4 + i, 2).alignment = { horizontal: "right" };
    [1, 2].forEach((c) => (sm.getCell(4 + i, c).border = { bottom: thin }));
  });
  const countBy = (key: (l: ExportLead) => string) => {
    const m = new Map<string, number>();
    for (const l of opts.leads) m.set(key(l), (m.get(key(l)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  };
  const block = (title: string, rows: [string, number][], r0: number, c0: number) => {
    const h = sm.getCell(r0, c0);
    h.value = title;
    h.font = { bold: true, color: { argb: ACCENT } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    sm.getCell(r0, c0 + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    rows.forEach(([k, n], i) => {
      sm.getCell(r0 + 1 + i, c0).value = k;
      sm.getCell(r0 + 1 + i, c0 + 1).value = n;
      [c0, c0 + 1].forEach((c) => (sm.getCell(r0 + 1 + i, c).border = { bottom: thin }));
    });
    if (rows.length) {
      const col = String.fromCharCode(64 + c0 + 1);
      sm.addConditionalFormatting({ ref: `${col}${r0 + 1}:${col}${r0 + rows.length}`, rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF818CF8" } } as unknown as ExcelJS.ConditionalFormattingRule] });
    }
    return r0 + rows.length + 2;
  };
  const r1 = 4 + stats.length + 2;
  const r2 = Math.max(block("By business type", countBy((l) => getPlaybook(l.businessType).label), r1, 1), block("By city", countBy((l) => l.city ?? "Unknown"), r1, 4));
  block("By lead status", countBy((l) => human(l.status) || "—"), r2, 1);
  block("By website status", countBy((l) => human(l.websiteClass ?? l.websiteStatus) || "—"), r2, 4);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
