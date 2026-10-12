"use client";
import { useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Download, Sheet, Image as ImageIcon } from "lucide-react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox, Field, Input } from "../ui/form";
import { useToast } from "../ui/toast";
import { cn } from "@/lib/utils";
import { EXPORT_COLUMNS, EXPORT_PRESETS, type ExportColumnId } from "@/lib/export-columns";
import { renderLeadCards, type LeadCardsPayload } from "./lead-cards-image";

type Scope = "filters" | "selected" | "all";
type Format = "csv" | "xlsx" | "pdf" | "image";
const FORMATS = [
  ["xlsx", Sheet, "Excel (.xlsx)", "Formatted spreadsheet: coloured scores, clickable links, a profile for each business and a summary sheet."],
  ["csv", FileSpreadsheet, "CSV", "Plain spreadsheet file for importing into other tools. Pick your columns."],
  ["pdf", FileText, "PDF report", "Printable report with a summary and a detailed section per lead (up to 300 leads)."],
  ["image", ImageIcon, "Image (PNG)", "Lead cards: what they do, services, address, phone, email and website (up to 120 leads)."],
] as const;
const LABEL: Record<Format, string> = { csv: "CSV", xlsx: "Excel", pdf: "PDF", image: "image" };
const SECTIONS = [
  { id: "summary", label: "Summary page", hint: "Key numbers, top opportunities, breakdowns by status, city and type" },
  { id: "contact", label: "Contact details", hint: "Phone, email, website, address, rating, hours" },
  { id: "audit", label: "Website audit", hint: "Audit summary and the main issues found" },
  { id: "opportunity", label: "Opportunity", hint: "Why it's an opportunity and the features they're missing" },
  { id: "outreach", label: "Outreach", hint: "Emails sent, replies, campaigns, tags, owner" },
  { id: "notes", label: "Notes", hint: "Latest notes" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const GROUPS = Array.from(new Set(EXPORT_COLUMNS.map((c) => c.group)));
const STORE = "ws_export_prefs";

export function ExportDialog({ open, onClose, filters, selectedIds = [], matching }: { open: boolean; onClose: () => void; filters: Record<string, string>; selectedIds?: string[]; matching?: number }) {
  const toast = useToast();
  const hasFilters = Object.keys(filters).some((k) => k !== "sort");
  const [scope, setScope] = useState<Scope>(selectedIds.length ? "selected" : hasFilters ? "filters" : "all");
  const [format, setFormat] = useState<Format>("xlsx");
  const [columns, setColumns] = useState<ExportColumnId[]>(EXPORT_PRESETS.find((p) => p.id === "sales")!.columns);
  const [sections, setSections] = useState<Record<SectionId, boolean>>({ summary: true, contact: true, audit: true, opportunity: true, outreach: true, notes: true });
  const [title, setTitle] = useState("Lead report");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.length ? "selected" : hasFilters ? "filters" : "all");
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { format?: Format; columns?: ExportColumnId[]; sections?: Record<SectionId, boolean> } | null;
      if (saved?.format) setFormat(saved.format);
      if (saved?.columns?.length) setColumns(saved.columns.filter((c) => EXPORT_COLUMNS.some((x) => x.id === c)));
      if (saved?.sections) setSections((s) => ({ ...s, ...saved.sections }));
    } catch { /* preferences are optional */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: ExportColumnId) => setColumns((c) => (c.includes(id) ? c.filter((x) => x !== id) : EXPORT_COLUMNS.map((x) => x.id).filter((x) => x === id || c.includes(x))));
  const canDownload = format === "pdf" ? Object.values(sections).some(Boolean) : format === "image" ? true : columns.length > 0;

  async function download() {
    setBusy(true);
    try {
      try { localStorage.setItem(STORE, JSON.stringify({ format, columns, sections })); } catch { /* ignore */ }
      const res = await fetch("/api/leads/export/report", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "webscout" },
        body: JSON.stringify({ format, scope, filters: scope === "filters" ? filters : undefined, ids: scope === "selected" ? selectedIds : undefined, columns, sections, title }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message ?? `Export failed (${res.status})`);
      }
      const save = (blob: Blob, name: string) => {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      if (format === "image") {
        const images = await renderLeadCards((await res.json()) as LeadCardsPayload);
        const stamp = new Date().toISOString().slice(0, 10);
        images.forEach((b, i) => save(b, `webscout-lead-cards-${stamp}${images.length > 1 ? `-${i + 1}` : ""}.png`));
        toast.success("Export ready", `${images.length} image${images.length > 1 ? "s" : ""} downloaded.`);
      } else {
        const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `leads.${format}`;
        save(await res.blob(), name);
        toast.success("Export ready", `${name} downloaded.`);
      }
      onClose();
    } catch (e) {
      toast.error("Export failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ScopeOption = ({ id, label, disabled }: { id: Scope; label: string; disabled?: boolean }) => (
    <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", scope === id ? "border-accent bg-accent/5" : "border-border", disabled && "cursor-not-allowed opacity-50")}>
      <input type="radio" name="export-scope" checked={scope === id} disabled={disabled} onChange={() => setScope(id)} className="accent-[var(--accent)]" /> {label}
    </label>
  );

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Export leads" description="Choose which leads, the format, and exactly what to include."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={download} loading={busy} loadingText="Preparing…" disabled={!canDownload}><Download className="h-4 w-4" /> Download {LABEL[format]}</Button></>}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Which leads</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <ScopeOption id="filters" label={`Current filters${matching != null ? ` (${matching})` : ""}`} disabled={!hasFilters} />
            <ScopeOption id="selected" label={`Selected (${selectedIds.length})`} disabled={!selectedIds.length} />
            <ScopeOption id="all" label="All leads" />
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Format</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {FORMATS.map(([id, Icon, label, hint]) => (
              <button key={id} type="button" onClick={() => setFormat(id)} aria-pressed={format === id} className={cn("flex gap-3 rounded-xl border p-3 text-left", format === id ? "border-accent bg-accent/5" : "border-border hover:bg-subtle/60")}>
                <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", format === id ? "text-accent" : "text-muted")} />
                <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
              </button>
            ))}
          </div>
        </section>
        {format === "csv" || format === "xlsx" ? (
          <section>
            {format === "xlsx" && <div className="mb-3"><Field label="Title" htmlFor="xt"><Input id="xt" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field></div>}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Columns ({columns.length})</h3>
              <div className="flex flex-wrap gap-1.5">
                {EXPORT_PRESETS.map((p) => <Button key={p.id} size="sm" variant="outline" onClick={() => setColumns(p.columns)}>{p.label}</Button>)}
                <Button size="sm" variant="ghost" onClick={() => setColumns([])}>Clear</Button>
              </div>
            </div>
            <div className="grid max-h-72 gap-4 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <fieldset key={g}>
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{g}</legend>
                  <div className="flex flex-col gap-1.5">
                    {EXPORT_COLUMNS.filter((c) => c.group === g).map((c) => <div key={c.id}><Checkbox checked={columns.includes(c.id)} onChange={() => toggle(c.id)} label={c.label} /></div>)}
                  </div>
                </fieldset>
              ))}
            </div>
          </section>
        ) : format === "image" ? (
          <section className="space-y-3">
            <Field label="Title" htmlFor="rt"><Input id="rt" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
            <p className="text-xs text-muted">Each lead becomes a card showing what the business does, the services listed on their website, their address, phone, email, website, Google rating and opportunity score. Up to 40 cards per image; leads are ordered by opportunity score.</p>
          </section>
        ) : (
          <section className="space-y-3">
            <Field label="Report title" htmlFor="rt"><Input id="rt" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Include</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {SECTIONS.map((s) => (
                  <div key={s.id} className="rounded-lg border border-border p-2.5">
                    <Checkbox checked={sections[s.id]} onChange={(v) => setSections({ ...sections, [s.id]: v })} label={<span className="font-medium">{s.label}</span>} />
                    <p className="ml-6 text-xs text-muted">{s.hint}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-faint">Leads are ordered by opportunity score (highest first).</p>
          </section>
        )}
      </div>
    </Dialog>
  );
}
