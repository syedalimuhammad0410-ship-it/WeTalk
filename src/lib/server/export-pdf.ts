import "./guard";
import PDFDocument from "pdfkit";
import { getPlaybook } from "./intel/playbooks";
import { leadMissingFeatures, leadReasons, type ExportLead } from "./export";

export type PdfSections = { summary: boolean; contact: boolean; audit: boolean; opportunity: boolean; outreach: boolean; notes: boolean };
export const DEFAULT_PDF_SECTIONS: PdfSections = { summary: true, contact: true, audit: true, opportunity: true, outreach: true, notes: true };

const C = { ink: "#111827", muted: "#6b7280", faint: "#9ca3af", line: "#e5e7eb", accent: "#4f46e5", soft: "#eef2ff", good: "#047857", warn: "#b45309", bad: "#b91c1c" };

/** The built-in PDF fonts use Windows-1252; replace anything they can't draw. */
const WIN1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function clean(s: unknown): string {
  return String(s ?? "")
    .replace(/[‐-‒]/g, "-")
    .replace(/[→➔]/g, "->")
    .replace(/[✓✔]/g, "Yes")
    .split("")
    .map((ch) => (ch.charCodeAt(0) <= 0xff || WIN1252_EXTRA.has(ch) ? ch : ""))
    .join("")
    .replace(/\s+\n/g, "\n")
    .trim();
}
const human = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");
const date = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
/** Higher is better for both scores shown (website quality, sales opportunity). */
const scoreColor = (n: number | null | undefined) => (n == null ? C.muted : n < 45 ? C.bad : n < 70 ? C.warn : C.good);

export async function buildLeadsPdf(opts: { leads: ExportLead[]; total: number; agency: string; title: string; scope: string; sections: PdfSections }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 60, left: 54, right: 54 }, bufferPages: true, info: { Title: clean(opts.title), Author: clean(opts.agency || "WebScout AI"), Creator: "WebScout AI" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const L = doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };
  const text = (s: unknown, o: { size?: number; color?: string; bold?: boolean; width?: number; x?: number; gap?: number; continued?: boolean } = {}) => {
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 10).fillColor(o.color ?? C.ink);
    doc.text(clean(s), o.x ?? L, undefined, { width: o.width ?? W, continued: o.continued, lineGap: o.gap ?? 1.5 });
  };
  const heading = (s: string) => { ensure(40); doc.moveDown(0.6); text(s.toUpperCase(), { size: 8.5, bold: true, color: C.accent }); doc.moveDown(0.25); };
  const rule = () => { doc.moveDown(0.5); doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.7).strokeColor(C.line).stroke(); doc.moveDown(0.5); };
  const bullets = (items: string[]) => { for (const it of items) { ensure(16); text(`•  ${it}`, { size: 9.5, x: L + 6, width: W - 6 }); } };
  const kv = (rows: [string, unknown][]) => {
    const colW = W / 2 - 8;
    for (let i = 0; i < rows.length; i += 2) {
      ensure(30);
      const y = doc.y;
      let maxY = y;
      for (const [j, row] of [rows[i], rows[i + 1]].entries()) {
        if (!row) continue;
        const x = L + j * (colW + 16);
        doc.font("Helvetica").fontSize(7.5).fillColor(C.faint).text(clean(row[0]).toUpperCase(), x, y, { width: colW });
        doc.font("Helvetica").fontSize(9.5).fillColor(C.ink).text(clean(row[1]) || "—", x, doc.y + 1, { width: colW, lineGap: 1 });
        maxY = Math.max(maxY, doc.y);
      }
      doc.y = maxY + 6;
    }
    doc.x = L;
  };
  const table = (head: string[], rows: string[][], widths: number[]) => {
    const draw = (cells: string[], bold: boolean) => {
      ensure(20);
      const y = doc.y;
      let x = L;
      let maxY = y;
      cells.forEach((c, i) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 8 : 9).fillColor(bold ? C.muted : C.ink).text(clean(c), x + 4, y + 4, { width: widths[i]! * W - 8, lineGap: 1 });
        maxY = Math.max(maxY, doc.y);
        x += widths[i]! * W;
      });
      doc.y = maxY + 4;
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.x = L;
    };
    draw(head, true);
    rows.forEach((r) => draw(r, false));
  };
  const statBoxes = (stats: [string, string][]) => {
    const n = stats.length;
    const bw = (W - (n - 1) * 10) / n;
    const y = doc.y;
    stats.forEach(([label, value], i) => {
      const x = L + i * (bw + 10);
      doc.roundedRect(x, y, bw, 54, 6).fillColor(C.soft).fill();
      doc.font("Helvetica-Bold").fontSize(18).fillColor(C.accent).text(clean(value), x + 10, y + 9, { width: bw - 20 });
      doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(clean(label), x + 10, y + 34, { width: bw - 20 });
    });
    doc.y = y + 66;
    doc.x = L;
  };
  const countBy = (key: (l: ExportLead) => string) => {
    const m = new Map<string, number>();
    for (const l of opts.leads) m.set(key(l), (m.get(key(l)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  // ── Summary page ──
  text(opts.agency || "WebScout AI", { size: 10, color: C.muted });
  text(opts.title, { size: 24, bold: true });
  text(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${opts.leads.length} lead${opts.leads.length === 1 ? "" : "s"}${opts.total > opts.leads.length ? ` (of ${opts.total} matching — first ${opts.leads.length} by opportunity)` : ""}`, { size: 9, color: C.muted });
  if (opts.scope) text(opts.scope, { size: 9, color: C.muted });
  doc.moveDown(1);

  if (opts.sections.summary && opts.leads.length) {
    const scored = opts.leads.filter((l) => l.opportunityScore != null);
    const avg = scored.length ? Math.round(scored.reduce((s, l) => s + l.opportunityScore!, 0) / scored.length) : null;
    statBoxes([
      ["Leads in report", String(opts.leads.length)],
      ["Avg. opportunity", avg == null ? "—" : `${avg}/100`],
      ["No working website", String(opts.leads.filter((l) => ["NO_WEBSITE", "WEBSITE_UNAVAILABLE"].includes(l.websiteStatus) || l.websiteClass === "BROKEN").length)],
      ["Contacted", String(opts.leads.filter((l) => l.lastContactedAt).length)],
      ["Responded", String(opts.leads.filter((l) => l.lastResponseAt).length)],
    ]);
    heading("Top opportunities");
    table(["Business", "Type", "City", "Website", "Opportunity"], [...opts.leads].filter((l) => l.opportunityScore != null).sort((a, b) => b.opportunityScore! - a.opportunityScore!).slice(0, 12).map((l) => [l.name, getPlaybook(l.businessType).label, l.city ?? "—", human(l.websiteClass ?? l.websiteStatus), `${l.opportunityScore}/100`]), [0.34, 0.2, 0.16, 0.16, 0.14]);
    // Breakdowns two per row so the summary stays compact.
    const mini = (title: string, rows: [string, number][], x: number, w: number, y0: number) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.accent).text(title.toUpperCase(), x, y0, { width: w });
      let y = doc.y + 3;
      for (const [k, n] of rows.slice(0, 6)) {
        doc.font("Helvetica").fontSize(9).fillColor(C.ink).text(clean(k), x, y, { width: w - 40, lineBreak: false, ellipsis: true });
        doc.text(String(n), x + w - 36, y, { width: 36, align: "right", lineBreak: false });
        y += 14;
        doc.moveTo(x, y - 2).lineTo(x + w, y - 2).lineWidth(0.5).strokeColor(C.line).stroke();
      }
      return y;
    };
    const pair = (a: [string, [string, number][]], b: [string, [string, number][]]) => {
      ensure(110);
      doc.moveDown(0.6);
      const y0 = doc.y;
      const w = (W - 24) / 2;
      const y1 = mini(a[0], a[1], L, w, y0);
      const y2 = mini(b[0], b[1], L + w + 24, w, y0);
      doc.y = Math.max(y1, y2) + 4;
      doc.x = L;
    };
    pair(["By lead status", countBy((l) => human(l.status))], ["By website status", countBy((l) => human(l.websiteStatus))]);
    pair(["By city", countBy((l) => l.city ?? "Unknown")], ["By business type", countBy((l) => getPlaybook(l.businessType).label)]);
  }

  // ── One section per lead ──
  const s = opts.sections;
  if (s.contact || s.audit || s.opportunity || s.outreach || s.notes) {
    doc.addPage();
    text("Lead details", { size: 18, bold: true });
    doc.moveDown(0.4);
    for (const l of opts.leads) {
      ensure(120);
      text(l.name, { size: 14, bold: true });
      text(`${getPlaybook(l.businessType).label}${l.city ? ` · ${l.city}` : ""} · ${human(l.status)}${l.doNotContact ? " · DO NOT CONTACT" : ""}`, { size: 9, color: C.muted });
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(9.5);
      doc.fillColor(scoreColor(l.opportunityScore)).text(`Opportunity ${l.opportunityScore ?? "—"}/100`, L, doc.y, { continued: true });
      doc.fillColor(C.faint).text("     ", { continued: true });
      doc.fillColor(scoreColor(l.websiteScore)).text(`Website ${l.websiteScore ?? "—"}/100`, { continued: true });
      doc.fillColor(C.faint).text("     ", { continued: true });
      doc.fillColor(C.ink).text(human(l.websiteClass ?? l.websiteStatus));
      doc.x = L;

      if (s.contact) {
        heading("Contact");
        kv([["Phone", l.phone], ["Email", l.email], ["Website", l.website ?? "No website found"], ["Address", l.address], ["Google rating", l.rating != null ? `${l.rating} (${l.reviewCount ?? 0} reviews)` : "—"], ["Google Maps", l.googleMapsUrl], ...(l.hours.length ? [["Hours", l.hours.slice(0, 7).join("; ")] as [string, unknown]] : [])]);
      }
      const audit = l.audits[0];
      if (s.audit && audit) {
        heading("Website audit");
        const summary = audit.aiSummary || audit.summary;
        if (summary) text(summary, { size: 9.5 });
        const issues = audit.findings.filter((f) => f.severity === "HIGH" || f.severity === "MEDIUM").slice(0, 6);
        if (issues.length) { doc.moveDown(0.3); bullets(issues.map((f) => `${f.severity === "HIGH" ? "[High] " : "[Medium] "}${f.title}${f.detail ? ` — ${f.detail.slice(0, 160)}` : ""}`)); }
      }
      if (s.opportunity) {
        const reasons = leadReasons(l).slice(0, 5);
        const missing = leadMissingFeatures(l).slice(0, 6);
        if (reasons.length || missing.length) {
          heading("Opportunity");
          if (reasons.length) bullets(reasons.map((r) => `${r.label}${r.kind === "INFERRED" ? " (inferred)" : ""}`));
          if (missing.length) { doc.moveDown(0.2); text("Recommended features they're missing:", { size: 9, bold: true }); bullets(missing.map((f) => `${f.name} (${f.priority})`)); }
        }
      }
      if (s.outreach) {
        heading("Outreach");
        kv([["Emails sent", l._count.messages], ["Response", l.lastResponseAt ? `Responded ${date(l.lastResponseAt)}` : l.lastContactedAt ? "Awaiting reply" : "Not contacted"], ["Last contacted", date(l.lastContactedAt)], ["Last reply intent", human(l.lastIntent)], ["Campaigns", l.campaignLeads.map((c) => c.campaign.name).join(", ") || "—"], ["Tags", l.tags.map((t) => t.tag.name).join(", ") || "—"], ["Assigned to", l.assignedTo?.name ?? "—"], ["Website prompt", l.prompts[0] ? `Quality ${l.prompts[0].qualityScore ?? "—"}/100` : "Not generated"]]);
      }
      if (s.notes && l.notes.length) {
        heading("Notes");
        for (const n of l.notes) { ensure(28); text(`${date(n.createdAt)}: ${n.body.slice(0, 400)}`, { size: 9 }); }
      }
      rule();
    }
  }

  // Footer with page numbers on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing in the footer area must not trigger a new page
    const y = doc.page.height - 38;
    doc.font("Helvetica").fontSize(8).fillColor(C.faint);
    doc.text(clean(`${opts.agency || "WebScout AI"} · ${opts.title}`), L, y, { width: W / 2, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
