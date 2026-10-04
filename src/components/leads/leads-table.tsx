"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Mail, ShieldOff } from "lucide-react";
import { Card, ScoreBadge, Badge } from "../ui/misc";
import { Checkbox } from "../ui/form";
import { Button } from "../ui/button";
import { formatNumber, timeAgo } from "@/lib/utils";
import { StatusBadge, WebsiteBadge } from "./status-badge";
import { BulkBar } from "./bulk-bar";
import type { Options, Perms } from "./leads-view";

export type LeadRow = {
  id: string; name: string; category: string | null; businessType: string | null; city: string | null; region: string | null; phone: string | null; email: string | null; website: string | null;
  status: string; websiteStatus: string; websiteClass: string | null; websiteScore: number | null; opportunityScore: number | null; leadScore: number | null;
  lastContactedAt: string | null; lastResponseAt: string | null; discoveredAt: string; doNotContact: boolean; isDemo: boolean; archived: boolean;
  assignedTo: { id: string; name: string } | null; tags: { tag: { id: string; name: string; color: string } }[];
};

export function LeadsTable({ data, options, perms, onPage }: { data: { total: number; page: number; pageSize: number; rows: LeadRow[] }; options: Options; perms: Perms; onPage: (p: number) => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const all = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id));
  const some = data.rows.some((r) => selected.has(r.id));
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <Card className="overflow-hidden">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10"><Checkbox checked={all} indeterminate={!all && some} onChange={(v) => setSelected(v ? new Set(data.rows.map((r) => r.id)) : new Set())} aria-label="Select all on this page" /></th>
                <th>Business</th>
                <th>Location</th>
                <th>Website</th>
                <th className="text-right">Score</th>
                <th className="text-right">Opportunity</th>
                <th>Status</th>
                <th>Contact</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-muted">No leads match these filters.</td></tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={(e) => { if ((e.target as HTMLElement).closest("input,a,button")) return; router.push(`/leads/${r.id}`); }}>
                  <td><Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                  <td className="max-w-[280px]">
                    <Link href={`/leads/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link>
                    <div className="flex items-center gap-1.5 truncate text-xs text-muted">
                      {r.category ?? "—"}
                      {r.isDemo && <Badge tone="amber">DEMO</Badge>}
                      {r.tags.slice(0, 2).map((t) => <Badge key={t.tag.id} tone="slate">{t.tag.name}</Badge>)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-muted">{r.city ?? "—"}</td>
                  <td><WebsiteBadge websiteClass={r.websiteClass} websiteStatus={r.websiteStatus} /></td>
                  <td className="text-right"><ScoreBadge score={r.websiteScore} label="Website score" /></td>
                  <td className="text-right"><ScoreBadge score={r.opportunityScore} label="Opportunity score" /></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="whitespace-nowrap text-xs text-muted">
                    {r.doNotContact ? <span className="inline-flex items-center gap-1 text-danger"><ShieldOff className="h-3.5 w-3.5" /> Do not contact</span> : r.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {r.lastResponseAt ? "Replied" : r.lastContactedAt ? `Contacted ${timeAgo(r.lastContactedAt)}` : "Has email"}</span> : "Not found"}
                  </td>
                  <td className="whitespace-nowrap text-xs text-muted">{timeAgo(r.discoveredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <ul className="divide-y divide-border md:hidden">
          {data.rows.length === 0 && <li className="py-12 text-center text-sm text-muted">No leads match these filters.</li>}
          {data.rows.map((r) => (
            <li key={r.id} className="flex gap-3 px-4 py-3">
              <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} className="mt-1" />
              <Link href={`/leads/${r.id}`} className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted">Opp <ScoreBadge score={r.opportunityScore} /></span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{[r.category, r.city].filter(Boolean).join(" · ") || "—"}</div>
                <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge status={r.status} /><WebsiteBadge websiteClass={r.websiteClass} websiteStatus={r.websiteStatus} /></div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
          <span>{formatNumber(data.total)} lead{data.total === 1 ? "" : "s"}{selected.size > 0 && ` · ${selected.size} selected`}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="tabular-nums">Page {data.page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>
      {selected.size > 0 && <BulkBar ids={Array.from(selected)} options={options} perms={perms} onDone={() => { setSelected(new Set()); router.refresh(); }} onClear={() => setSelected(new Set())} />}
    </>
  );
}
