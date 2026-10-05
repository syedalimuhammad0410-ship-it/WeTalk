"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Columns3, Download, Filter, LayoutList, Plus, Search, Upload, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input, Select } from "../ui/form";
import { Card, EmptyState, Badge } from "../ui/misc";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";
import { LEAD_STATUSES, LEAD_STATUS_META, WEBSITE_CLASS_META, WEBSITE_STATUS_META } from "@/lib/constants";
import { LeadsTable, type LeadRow } from "./leads-table";
import { PipelineBoard, type Column } from "./pipeline-board";
import { AddLeadDialog, ImportDialog } from "./lead-dialogs";

export type Options = {
  tags: { id: string; name: string }[];
  members: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  savedFilters: { id: string; name: string; filters: Record<string, string> }[];
  templates: { id: string; name: string }[];
  businessTypes: { id: string; label: string }[];
};
export type Perms = { edit: boolean; status: boolean; del: boolean; exp: boolean; send: boolean; reverseDnc: boolean };

const FILTER_KEYS = ["q", "status", "city", "category", "businessType", "websiteStatus", "websiteClass", "minWebsiteScore", "maxWebsiteScore", "minOpportunity", "maxOpportunity", "response", "campaignId", "discoveredFrom", "discoveredTo", "contactedFrom", "contactedTo", "assignedToId", "tagIds", "hasEmail", "archived", "sort"];

export function LeadsView({ view, data, columns, options, perms, openAdd }: { view: "table" | "pipeline"; data: { total: number; page: number; pageSize: number; rows: LeadRow[] } | null; columns: Column[] | null; options: Options; perms: Perms;  openAdd: boolean; filters?: Record<string, unknown> }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [adding, setAdding] = useState(openAdd);
  const [importing, setImporting] = useState(false);

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    if (resetPage) p.delete("page");
    start(() => router.push(`${pathname}?${p.toString()}`));
  };

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) setParams({ q: q || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const activeFilters = useMemo(() => FILTER_KEYS.filter((k) => k !== "q" && k !== "sort" && sp.get(k)), [sp]);
  const exportHref = `/api/leads/export?${new URLSearchParams(Object.fromEntries(FILTER_KEYS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!]))).toString()}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, city, website…" className="pl-9" aria-label="Search leads" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={showFilters || activeFilters.length ? "subtle" : "outline"} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <Filter className="h-4 w-4" /> Filters {activeFilters.length > 0 && <Badge tone="indigo">{activeFilters.length}</Badge>}
          </Button>
          <SavedFilters options={options} />
          <Select value={sp.get("sort") ?? "newest"} onChange={(e) => setParams({ sort: e.target.value })} className="h-9 w-auto py-1" aria-label="Sort">
            <option value="newest">Newest</option>
            <option value="opportunity">Highest opportunity</option>
            <option value="website_score">Lowest website score</option>
            <option value="lead_score">Highest lead score</option>
            <option value="last_contacted">Recently contacted</option>
            <option value="name">Name A–Z</option>
            <option value="oldest">Oldest</option>
          </Select>
          <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="View">
            <button onClick={() => setParams({ view: null }, false)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm", view === "table" ? "bg-subtle font-medium" : "text-muted")} aria-pressed={view === "table"}><LayoutList className="h-4 w-4" /> Table</button>
            <button onClick={() => setParams({ view: "pipeline" }, false)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm", view === "pipeline" ? "bg-subtle font-medium" : "text-muted")} aria-pressed={view === "pipeline"}><Columns3 className="h-4 w-4" /> Pipeline</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {perms.exp && <a href={exportHref} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium shadow-sm hover:bg-subtle"><Download className="h-4 w-4" /> Export</a>}
          {perms.edit && <Button variant="outline" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import</Button>}
          {perms.edit && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add lead</Button>}
        </div>
      </div>

      {showFilters && <FilterPanel options={options} onApply={(patch) => setParams(patch)} onClose={() => setShowFilters(false)} />}

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((k) => (
            <button key={k} onClick={() => setParams({ [k]: null })} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-subtle">
              <span className="text-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}:</span> {labelFor(k, sp.get(k)!, options)} <X className="h-3 w-3" />
            </button>
          ))}
          <button className="text-xs font-medium text-accent hover:underline" onClick={() => start(() => router.push(`${pathname}${view === "pipeline" ? "?view=pipeline" : ""}`))}>Clear all</button>
        </div>
      )}

      <div className={cn("transition-opacity", pending && "opacity-60")}>
        {view === "table" && data && (data.rows.length === 0 && data.total === 0 && activeFilters.length === 0 && !q ? (
          <Card>
            <EmptyState icon={<Search className="h-5 w-5" />} title="No businesses yet." description="Discover businesses with Google Places, add one manually, or import a CSV." action={<div className="flex gap-2"><Link href="/discover" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg">Find your first businesses</Link>{perms.edit && <Button variant="outline" onClick={() => setAdding(true)}>Add manually</Button>}</div>} />
          </Card>
        ) : (
          <LeadsTable data={data} options={options} perms={perms} onPage={(p) => setParams({ page: String(p) }, false)} />
        ))}
        {view === "pipeline" && columns && <PipelineBoard columns={columns} perms={perms} />}
      </div>
      <AddLeadDialog open={adding} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); toast.success("Lead added"); router.push(`/leads/${id}`); }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={() => { setImporting(false); router.refresh(); }} />
      <span className="sr-only" aria-live="polite">{pending ? "Loading leads…" : ""}</span>
    </div>
  );
}

function labelFor(k: string, v: string, o: Options) {
  if (k === "status") return v.split(",").map((s) => LEAD_STATUS_META[s as keyof typeof LEAD_STATUS_META]?.label ?? s).join(", ");
  if (k === "websiteClass") return v.split(",").map((s) => WEBSITE_CLASS_META[s]?.label ?? s).join(", ");
  if (k === "websiteStatus") return v.split(",").map((s) => WEBSITE_STATUS_META[s]?.label ?? s).join(", ");
  if (k === "campaignId") return o.campaigns.find((c) => c.id === v)?.name ?? v;
  if (k === "assignedToId") return v === "unassigned" ? "Unassigned" : o.members.find((m) => m.id === v)?.name ?? v;
  if (k === "tagIds") return v.split(",").map((id) => o.tags.find((t) => t.id === id)?.name ?? id).join(", ");
  if (k === "businessType") return o.businessTypes.find((b) => b.id === v)?.label ?? v;
  return v;
}

function FilterPanel({ options, onApply, onClose }: { options: Options; onApply: (p: Record<string, string | null>) => void; onClose: () => void }) {
  const sp = useSearchParams();
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ""])));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const multi = (k: string, values: string[]) => setF((s) => ({ ...s, [k]: values.join(",") }));
  const sel = (k: string) => (f[k] ? f[k]!.split(",") : []);
  const toggle = (k: string, v: string) => multi(k, sel(k).includes(v) ? sel(k).filter((x) => x !== v) : [...sel(k), v]);
  return (
    <Card className="animate-fade-in p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FilterField label="Location (city)"><Input value={f.city} onChange={set("city")} placeholder="Mississauga" /></FilterField>
        <FilterField label="Category"><Input value={f.category} onChange={set("category")} placeholder="restaurant" /></FilterField>
        <FilterField label="Business type">
          <Select value={f.businessType} onChange={set("businessType")}><option value="">Any</option>{options.businessTypes.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select>
        </FilterField>
        <FilterField label="Response status">
          <Select value={f.response} onChange={set("response")}><option value="">Any</option><option value="replied">Replied</option><option value="no_reply">Contacted, no reply</option><option value="not_contacted">Not contacted</option></Select>
        </FilterField>
        <FilterField label="Website score"><div className="flex gap-2"><Input type="number" min={0} max={100} value={f.minWebsiteScore} onChange={set("minWebsiteScore")} placeholder="Min" /><Input type="number" min={0} max={100} value={f.maxWebsiteScore} onChange={set("maxWebsiteScore")} placeholder="Max" /></div></FilterField>
        <FilterField label="Opportunity score"><div className="flex gap-2"><Input type="number" min={0} max={100} value={f.minOpportunity} onChange={set("minOpportunity")} placeholder="Min" /><Input type="number" min={0} max={100} value={f.maxOpportunity} onChange={set("maxOpportunity")} placeholder="Max" /></div></FilterField>
        <FilterField label="Campaign"><Select value={f.campaignId} onChange={set("campaignId")}><option value="">Any</option>{options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FilterField>
        <FilterField label="Assigned to"><Select value={f.assignedToId} onChange={set("assignedToId")}><option value="">Anyone</option><option value="unassigned">Unassigned</option>{options.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></FilterField>
        <FilterField label="Discovered between"><div className="flex gap-2"><Input type="date" value={f.discoveredFrom} onChange={set("discoveredFrom")} aria-label="Discovered from" /><Input type="date" value={f.discoveredTo} onChange={set("discoveredTo")} aria-label="Discovered to" /></div></FilterField>
        <FilterField label="Contacted between"><div className="flex gap-2"><Input type="date" value={f.contactedFrom} onChange={set("contactedFrom")} aria-label="Contacted from" /><Input type="date" value={f.contactedTo} onChange={set("contactedTo")} aria-label="Contacted to" /></div></FilterField>
        <FilterField label="Has email"><Select value={f.hasEmail} onChange={set("hasEmail")}><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></Select></FilterField>
        <FilterField label="Archived"><Select value={f.archived} onChange={set("archived")}><option value="">Active only</option><option value="yes">Archived only</option><option value="all">All</option></Select></FilterField>
      </div>
      <ChipGroup label="Lead status" values={LEAD_STATUSES.map((s) => ({ id: s, label: LEAD_STATUS_META[s].label }))} selected={sel("status")} onToggle={(v) => toggle("status", v)} />
      <ChipGroup label="Website" values={Object.entries(WEBSITE_CLASS_META).map(([id, m]) => ({ id, label: m.label }))} selected={sel("websiteClass")} onToggle={(v) => toggle("websiteClass", v)} />
      {options.tags.length > 0 && <ChipGroup label="Tags" values={options.tags.map((t) => ({ id: t.id, label: t.name }))} selected={sel("tagIds")} onToggle={(v) => toggle("tagIds", v)} />}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button onClick={() => { onApply(Object.fromEntries(FILTER_KEYS.filter((k) => k !== "q" && k !== "sort").map((k) => [k, f[k] || null]))); onClose(); }}>Apply filters</Button>
      </div>
    </Card>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label text-xs text-muted">{label}</div>
      {children}
    </div>
  );
}

function ChipGroup({ label, values, selected, onToggle }: { label: string; values: { id: string; label: string }[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="label text-xs text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <button key={v.id} type="button" onClick={() => onToggle(v.id)} aria-pressed={selected.includes(v.id)} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", selected.includes(v.id) ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:bg-subtle")}>
            {v.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SavedFilters({ options }: { options: Options }) {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const current = Object.fromEntries(FILTER_KEYS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!]));
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}><Bookmark className="h-4 w-4" /> Saved</Button>
      {open && (
        <div className="absolute left-0 top-11 z-30 w-72 animate-fade-in rounded-xl border border-border bg-surface p-2 shadow-pop">
          {options.savedFilters.length === 0 && <p className="px-2 py-2 text-xs text-muted">No saved filters yet.</p>}
          {options.savedFilters.map((f) => (
            <div key={f.id} className="group flex items-center rounded-lg hover:bg-subtle">
              <button className="flex-1 px-2.5 py-2 text-left text-sm" onClick={() => { setOpen(false); router.push(`/leads?${new URLSearchParams(f.filters).toString()}`); }}>{f.name}</button>
              <button className="px-2 text-faint opacity-0 hover:text-danger group-hover:opacity-100" aria-label={`Delete ${f.name}`} onClick={async () => { await apiFetch(`/api/saved-filters/${f.id}`, { method: "DELETE" }).catch((e) => toast.error((e as Error).message)); router.refresh(); }}><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <form className="mt-2 flex gap-2 border-t border-border pt-2" onSubmit={async (e) => { e.preventDefault(); try { await apiFetch("/api/saved-filters", { body: { name, filters: current } }); toast.success("Filter saved"); setName(""); router.refresh(); } catch (err) { toast.error("Couldn't save", (err as Error).message); } }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save current view as…" className="h-8 text-sm" aria-label="Saved filter name" />
            <Button size="sm" type="submit" disabled={!name.trim() || Object.keys(current).length === 0}>Save</Button>
          </form>
        </div>
      )}
    </div>
  );
}
