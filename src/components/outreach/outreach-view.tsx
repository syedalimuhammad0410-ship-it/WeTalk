"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronUp, ShieldCheck, X } from "lucide-react";
import { Alert, Badge, Card, EmptyState } from "../ui/misc";
import { Button } from "../ui/button";
import { Input, Select } from "../ui/form";
import { ConfirmDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

const ELIG: Record<string, [string, any]> = { ELIGIBLE: ["Eligible", "green"], NEEDS_REVIEW: ["Needs review", "amber"], INELIGIBLE: ["Not eligible", "red"] };
const BASIS: Record<string, string> = { EXPRESS: "Express consent", IMPLIED_CONSPICUOUS_PUBLICATION: "Implied — conspicuously published", IMPLIED_EXISTING_RELATIONSHIP: "Implied — existing relationship", NONE: "No documented basis" };

export function OutreachView({ stats, queue, filters, campaigns, types, mode, perms }: { stats: Record<string, number>; queue: any; filters: Record<string, any>; campaigns: { id: string; name: string }[]; types: { id: string; label: string }[]; mode: string; perms: { approve: boolean } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [city, setCity] = useState(filters.city ?? "");

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  };
  const sendable = (i: any) => i.eligibility.eligibility !== "INELIGIBLE" && !i.unfilled && i.to;

  async function decide(action: "approve" | "reject", ids: string[]) {
    setBusy(true);
    try {
      const r = await apiFetch<any>("/api/outreach", { body: action === "approve" ? { action, messageIds: ids, confirmCount: ids.length } : { action, messageIds: ids } });
      if (action === "approve") {
        kickJobs();
        toast.success(`${r.approved} email${r.approved === 1 ? "" : "s"} approved — sending within your limits`, r.skipped.length ? `${r.skipped.length} blocked: ${r.skipped[0].reason}` : undefined);
      } else toast.success(`${r.rejected} draft${r.rejected === 1 ? "" : "s"} rejected`);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast.error("Action failed", (e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const tiles: [string, number, string?][] = [
    ["Drafts generated", stats.drafts], ["Awaiting approval", stats.awaiting], ["Eligible for sending", stats.eligible], ["Emails sent", stats.sent],
    ["Delivery failures", stats.failed], ["Replies received", stats.replies], ["Unsubscribe requests", stats.unsubscribes], ["Suppressed contacts", stats.suppressed], ["Interested businesses", stats.interested],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([l, n]) => <Card key={l} className="p-4"><div className="text-2xl font-semibold tabular-nums">{(n ?? 0).toLocaleString("en-US")}</div><div className="text-[13px] text-muted">{l}</div></Card>)}
      </div>
      <Alert tone="info" title={mode === "AUTOMATED_ELIGIBLE" ? "Mode: automated eligible outreach" : mode === "MANUAL" ? "Mode: manual" : "Mode: approval required"}>
        {mode === "AUTOMATED_ELIGIBLE" ? "Drafts to contacts with a documented, valid consent basis can be sent automatically; everything else waits here." : "Nothing is sent until you approve it here."} A publicly visible address is not proof of consent — each recipient shows the basis and evidence recorded for it. Change the mode in Settings → Automation Control Center.
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Select aria-label="Campaign" value={filters.campaignId ?? ""} onChange={(e) => setParam("campaignId", e.target.value)} className="w-56"><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select aria-label="Business category" value={filters.businessType ?? ""} onChange={(e) => setParam("businessType", e.target.value)} className="w-48"><option value="">All categories</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
        <Select aria-label="Eligibility" value={filters.eligibility ?? ""} onChange={(e) => setParam("eligibility", e.target.value)} className="w-44"><option value="">Any eligibility</option><option value="ELIGIBLE">Eligible</option><option value="NEEDS_REVIEW">Needs review</option><option value="INELIGIBLE">Not eligible</option></Select>
        <form onSubmit={(e) => { e.preventDefault(); setParam("city", city); }}><Input aria-label="Location" placeholder="City…" value={city} onChange={(e) => setCity(e.target.value)} className="w-40" /></form>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <div className="text-sm font-medium">{queue.total} draft{queue.total === 1 ? "" : "s"} awaiting a decision</div>
          {perms.approve && mode !== "MANUAL" && queue.items.length > 0 && (
            <div className="flex gap-2">
              {selected.size > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("reject", Array.from(selected))}><X className="h-4 w-4" /> Reject {selected.size}</Button>}
              <Button size="sm" disabled={busy} onClick={() => setConfirm(selected.size ? Array.from(selected) : queue.items.filter((i: any) => sendable(i) && i.eligibility.eligibility === "ELIGIBLE").map((i: any) => i.id))}><CheckCircle2 className="h-4 w-4" /> {selected.size ? `Approve ${selected.size} selected` : "Approve all eligible on this page"}</Button>
            </div>
          )}
        </div>
        {queue.items.length === 0 ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="Nothing waiting" description="Drafts from AutoProspect and the Leads page appear here for review." /> : (
          <ul className="divide-y divide-border">
            {queue.items.map((i: any) => {
              const e = i.eligibility;
              return (
                <li key={i.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {perms.approve && <input type="checkbox" aria-label={`Select ${i.business?.name}`} checked={selected.has(i.id)} disabled={!sendable(i)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} className="accent-[var(--accent)]" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><Link href={`/leads/${i.business?.id}`} className="font-medium hover:text-accent">{i.business?.name}</Link>{i.campaign && <Badge tone="indigo">{i.campaign.name}</Badge>}{i.aiGenerated && <Badge tone="violet">AI</Badge>}<Badge tone={ELIG[e.eligibility]?.[1] ?? "zinc"}>{ELIG[e.eligibility]?.[0] ?? e.eligibility}</Badge></div>
                      <div className="truncate text-xs text-muted">To {i.to || "—"} · {i.subject}</div>
                    </div>
                    <button className="text-xs font-medium text-accent" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? <span className="inline-flex items-center gap-1">Hide <ChevronUp className="h-3.5 w-3.5" /></span> : <span className="inline-flex items-center gap-1">Review <ChevronDown className="h-3.5 w-3.5" /></span>}</button>
                    {perms.approve && mode !== "MANUAL" && <Button size="sm" disabled={busy || !sendable(i)} onClick={() => setConfirm([i.id])}>Approve & send</Button>}
                    {perms.approve && <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("reject", [i.id])} aria-label="Reject"><X className="h-4 w-4" /></Button>}
                  </div>
                  {open === i.id && (
                    <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_300px]">
                      <div className="rounded-lg bg-subtle p-3 text-sm"><div className="mb-2 font-medium">{i.subject}</div><p className="whitespace-pre-wrap">{i.body}</p><p className="mt-3 border-t border-border pt-2 text-xs text-muted">Your signature, sender address and a working unsubscribe link are added automatically when sent.</p></div>
                      <div className="space-y-2 text-xs">
                        <div className="rounded-lg border border-border p-3"><div className="font-medium">Consent basis</div><div className="mt-0.5 text-muted">{BASIS[e.basis] ?? e.basis}</div><div className="mt-1">{e.reason}</div></div>
                        {i.unfilled && <p className="text-warning">Contains unfilled template variables — edit it on the lead before sending.</p>}
                        {i.notes.map((n: string) => <p key={n} className="text-muted">{n}</p>)}
                        <Link href={`/leads/${i.business?.id}?tab=emails`} className="font-medium text-accent hover:underline">Edit this draft →</Link>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {queue.total > queue.pageSize && (
          <div className="flex justify-between border-t border-border px-5 py-3 text-sm">
            <Button size="sm" variant="ghost" disabled={queue.page <= 1} onClick={() => { const p = new URLSearchParams(sp.toString()); p.set("page", String(queue.page - 1)); router.push(`${pathname}?${p}`); }}>Previous</Button>
            <span className="text-muted">Page {queue.page} of {Math.ceil(queue.total / queue.pageSize)}</span>
            <Button size="sm" variant="ghost" disabled={queue.page * queue.pageSize >= queue.total} onClick={() => { const p = new URLSearchParams(sp.toString()); p.set("page", String(queue.page + 1)); router.push(`${pathname}?${p}`); }}>Next</Button>
          </div>
        )}
      </Card>
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} tone="primary" title={`Send ${confirm?.length ?? 0} email${confirm?.length === 1 ? "" : "s"}?`} confirmLabel={`Approve & send ${confirm?.length ?? 0}`} confirmDisabled={!confirm?.length} loading={busy} onConfirm={() => decide("approve", confirm!)} description="Each email goes to the recipient shown, within your hourly/daily limits and spacing. Recipients marked Not eligible are blocked automatically." />
    </div>
  );
}
