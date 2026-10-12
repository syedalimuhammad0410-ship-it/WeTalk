"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Select } from "../ui/form";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { EMAIL_CATEGORIES, INTENT_META, type InboxSection } from "@/lib/constants";

export type InboxFilterState = { cat?: string; contacted?: boolean; link?: string; intent?: string; days?: number; q?: string };

/** Builds the inbox URL for a section + filters (page resets to 1). */
export function inboxHref(section: InboxSection, f: InboxFilterState, page?: number) {
  const p = new URLSearchParams({ section });
  if (f.cat) p.set("cat", f.cat);
  if (f.contacted) p.set("contacted", "1");
  if (f.link) p.set("link", f.link);
  if (f.intent) p.set("intent", f.intent);
  if (f.days) p.set("days", String(f.days));
  if (f.q) p.set("q", f.q);
  if (page && page > 1) p.set("page", String(page));
  return `/inbox?${p.toString()}`;
}

const QUICK: { label: string; patch: InboxFilterState; count: (c: Counts) => number | undefined }[] = [
  { label: "People we contacted", patch: { contacted: true }, count: (c) => c.contacted },
  { label: "Replies from leads", patch: { cat: "lead_reply" }, count: (c) => c.byCategory.lead_reply },
  { label: "New enquiries", patch: { cat: "enquiry" }, count: (c) => c.byCategory.enquiry },
  { label: "Verification codes", patch: { cat: "verification_code" }, count: (c) => c.byCategory.verification_code },
  { label: "Confirmation emails", patch: { cat: "confirmation" }, count: (c) => c.byCategory.confirmation },
  { label: "Newsletters & promos", patch: { cat: "newsletter_promo" }, count: (c) => c.byCategory.newsletter_promo },
];
type Counts = { byCategory: Record<string, number>; contacted: number };

export function InboxFilters({ section, filters, counts }: { section: InboxSection; filters: InboxFilterState; counts: Counts }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? "");
  const [open, setOpen] = useState(Boolean(filters.link || filters.intent || filters.days));
  useEffect(() => setQ(filters.q ?? ""), [filters.q]);
  const go = (patch: InboxFilterState) => router.push(inboxHref(section, { ...filters, ...patch }));
  const active = Boolean(filters.cat || filters.contacted || filters.link || filters.intent || filters.days || filters.q);
  const isOn = (patch: InboxFilterState) => (patch.contacted ? Boolean(filters.contacted) : filters.cat === patch.cat);

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || undefined }); }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input aria-label="Search emails" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sender, subject, business or message text…" className="pl-9" />
        </form>
        <Select aria-label="Email type" value={filters.cat ?? ""} onChange={(e) => go({ cat: e.target.value || undefined })} className="sm:w-60">
          <option value="">All email types</option>
          {EMAIL_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}{counts.byCategory[c.id] ? ` (${counts.byCategory[c.id]})` : ""}</option>)}
        </Select>
        <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}><SlidersHorizontal className="h-4 w-4" /> More filters</Button>
        {active && <Button variant="ghost" onClick={() => router.push(inboxHref(section, {}))}><X className="h-4 w-4" /> Clear</Button>}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
        {QUICK.map((f) => {
          const on = isOn(f.patch);
          const n = f.count(counts);
          return (
            <button key={f.label} type="button" aria-pressed={on}
              onClick={() => go(on ? (f.patch.contacted ? { contacted: undefined } : { cat: undefined }) : f.patch)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-accent bg-accent text-white" : "border-border bg-subtle/60 text-muted hover:text-fg")}>
              {f.label}{n ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>
      {open && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Select aria-label="Lead link" value={filters.link ?? ""} onChange={(e) => go({ link: e.target.value || undefined })}>
            <option value="">Leads and other senders</option>
            <option value="lead">Linked to a lead</option>
            <option value="unlinked">Not linked to a lead</option>
          </Select>
          <Select aria-label="Intent" value={filters.intent ?? ""} onChange={(e) => go({ intent: e.target.value || undefined })}>
            <option value="">Any intent</option>
            {Object.entries(INTENT_META).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
          </Select>
          <Select aria-label="Date" value={filters.days ? String(filters.days) : ""} onChange={(e) => go({ days: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        </div>
      )}
      {(filters.cat || filters.contacted) && section !== "filtered" && <p className="text-xs text-faint">Includes emails filtered as not related, so you can find codes and confirmations.</p>}
    </div>
  );
}
