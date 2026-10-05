"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";
import { LEAD_STATUSES, LEAD_STATUS_META, type LeadStatusT } from "@/lib/constants";
import { Badge, ScoreBadge } from "../ui/misc";
import { useToast } from "../ui/toast";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Textarea, Select } from "../ui/form";
import type { Perms } from "./leads-view";
import { RelTime } from "@/components/ui/time";

export type Column = { status: LeadStatusT; count: number; leads: { id: string; name: string; city: string | null; category: string | null; opportunityScore: number | null; websiteScore: number | null; websiteClass: string | null; statusChangedAt: string; doNotContact: boolean; isDemo: boolean; email: string | null }[] };

export function PipelineBoard({ columns: initial, perms }: { columns: Column[]; perms: Perms }) {
  const router = useRouter();
  const toast = useToast();
  const [columns, setColumns] = useState(initial);
  const [drag, setDrag] = useState<{ id: string; from: LeadStatusT } | null>(null);
  const [over, setOver] = useState<LeadStatusT | null>(null);
  const [reverse, setReverse] = useState<{ id: string; to: LeadStatusT } | null>(null);
  const [reason, setReason] = useState("");
  const [moveFor, setMoveFor] = useState<{ id: string; from: LeadStatusT } | null>(null);

  async function move(id: string, from: LeadStatusT, to: LeadStatusT, why?: string) {
    if (from === to) return;
    if (!perms.status) return toast.error("Your role can't change lead status.");
    if (from === "DO_NOT_CONTACT" && !why) {
      if (!perms.reverseDnc) return toast.error("Only admins can reverse Do Not Contact.");
      setReverse({ id, to });
      return;
    }
    const prev = columns;
    const lead = columns.find((c) => c.status === from)?.leads.find((l) => l.id === id);
    if (!lead) return;
    setColumns((cols) => cols.map((c) => (c.status === from ? { ...c, count: c.count - 1, leads: c.leads.filter((l) => l.id !== id) } : c.status === to ? { ...c, count: c.count + 1, leads: [{ ...lead, statusChangedAt: new Date().toISOString() }, ...c.leads] } : c)));
    try {
      await apiFetch(`/api/leads/${id}/status`, { body: { status: to, reason: why } });
      toast.success(`Moved to ${LEAD_STATUS_META[to].label}`);
      router.refresh();
    } catch (e) {
      setColumns(prev);
      toast.error("Couldn't move lead", (e as Error).message);
    }
  }

  return (
    <>
      <div className="scrollbar-thin -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {columns.map((col) => (
          <section
            key={col.status}
            aria-label={`${LEAD_STATUS_META[col.status].label} column`}
            className={cn("flex max-h-[calc(100vh-260px)] w-[280px] shrink-0 snap-start flex-col rounded-xl border bg-subtle/50 transition-colors", over === col.status ? "border-accent bg-accent/5" : "border-border")}
            onDragOver={(e) => { if (drag && perms.status) { e.preventDefault(); setOver(col.status); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); if (drag) move(drag.id, drag.from, col.status); setDrag(null); }}
          >
            <header className="flex items-center justify-between px-3 py-2.5">
              <Badge tone={LEAD_STATUS_META[col.status].tone} dot>{LEAD_STATUS_META[col.status].label}</Badge>
              <span className="text-xs tabular-nums text-muted">{col.count}</span>
            </header>
            <ul className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {col.leads.length === 0 && <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-faint">Drop leads here</li>}
              {col.leads.map((l) => (
                <li
                  key={l.id}
                  draggable={perms.status}
                  onDragStart={() => setDrag({ id: l.id, from: col.status })}
                  onDragEnd={() => setDrag(null)}
                  className={cn("group rounded-lg border border-border bg-surface p-3 shadow-card transition-shadow hover:shadow-pop", drag?.id === l.id && "opacity-50")}
                >
                  <div className="flex items-start gap-2">
                    {perms.status && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-faint" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <Link href={`/leads/${l.id}`} className="block truncate text-sm font-medium hover:text-accent">{l.name}</Link>
                      <div className="truncate text-xs text-muted">{[l.category, l.city].filter(Boolean).join(" · ") || "—"}</div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted">
                        <span>Opp <ScoreBadge score={l.opportunityScore} /></span>
                        <span title={new Date(l.statusChangedAt).toLocaleString()}><RelTime d={l.statusChangedAt} /></span>
                      </div>
                    </div>
                  </div>
                  {perms.status && (
                    <button onClick={() => setMoveFor({ id: l.id, from: col.status })} className="mt-2 w-full rounded-md border border-border py-1 text-xs text-muted hover:bg-subtle lg:hidden">Move…</button>
                  )}
                </li>
              ))}
              {col.count > col.leads.length && <li className="pt-1 text-center text-xs"><Link href={`/leads?status=${col.status}`} className="text-accent hover:underline">View all {col.count}</Link></li>}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted">Drag cards between columns to change status (keyboard/touch: use “Move…”). Every change is recorded with a timestamp.</p>
      <Dialog open={Boolean(moveFor)} onClose={() => setMoveFor(null)} title="Move lead" footer={<Button variant="outline" onClick={() => setMoveFor(null)}>Cancel</Button>}>
        <Field label="New status" htmlFor="mv">
          <Select id="mv" defaultValue="" onChange={(e) => { if (moveFor && e.target.value) { move(moveFor.id, moveFor.from, e.target.value as LeadStatusT); setMoveFor(null); } }}>
            <option value="">Choose…</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_META[s].label}</option>)}
          </Select>
        </Field>
      </Dialog>
      <Dialog open={Boolean(reverse)} onClose={() => { setReverse(null); setReason(""); }} title="Reverse Do Not Contact?" description="Only do this if the business explicitly asked to be contacted again. The reason is recorded in the activity log."
        footer={<><Button variant="outline" onClick={() => { setReverse(null); setReason(""); }}>Cancel</Button><Button disabled={reason.trim().length < 10} onClick={() => { if (reverse) move(reverse.id, "DO_NOT_CONTACT", reverse.to, reason.trim()); setReverse(null); setReason(""); }}>Reverse and move</Button></>}>
        <Field label="Reason" htmlFor="rev" hint="Minimum 10 characters."><Textarea id="rev" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Owner emailed on 12 Oct asking us to send a proposal." /></Field>
      </Dialog>
    </>
  );
}
