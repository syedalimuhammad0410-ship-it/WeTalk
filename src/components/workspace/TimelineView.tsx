"use client";
import { useState } from "react";
import { Clock3, Plus } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Button, Empty, cn, inputCls } from "@/components/ui";
import { nowIso, uid, yearOf } from "@/lib/util";

const KIND_COLOR: Record<string, string> = {
  construction: "bg-cyan",
  opening: "bg-ok",
  renaming: "bg-violet-400",
  tenancy: "bg-signal",
  closure: "bg-alert",
  photo: "bg-warn",
  user: "bg-warn",
  event: "bg-cyan",
  publication: "bg-cyan",
  other: "bg-white/40",
};

export function TimelineView() {
  const inv = useWorkspace((s) => s.inv)!;
  const [cand, setCand] = useState<string>("all");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const events = [...inv.timeline].filter((t) => cand === "all" || t.candidateId === cand || !t.candidateId).sort((a, b) => a.year - b.year || a.date.localeCompare(b.date));
  const add = () => {
    const y = yearOf(date);
    if (!y || !label.trim()) return;
    ws.update((i) => ({ ...i, timeline: [...i.timeline, { id: uid("t"), date, year: y, label: label.trim(), kind: "user", sourceIds: [], userProvided: true }] }));
    setDate("");
    setLabel("");
  };
  void nowIso;
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <div className="mr-auto">
          <h2 className="text-[16px] font-semibold">Investigation timeline</h2>
          <p className="text-[12px] text-mute">A place can look very different in different years. Dated events come from sources; your entries are marked as user-provided.</p>
        </div>
        <select aria-label="Filter by candidate" value={cand} onChange={(e) => setCand(e.target.value)} className="h-8 rounded-[5px] border border-line-strong bg-black/30 px-2 text-[12.5px]">
          <option value="all">All candidates</option>
          {inv.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {!events.length ? (
        <Empty icon={<Clock3 className="size-7" />} title="No dated events yet">
          Dates are added from knowledge-graph records (openings, renamings, tenancies), photo metadata, and your notes.
        </Empty>
      ) : (
        <ol className="relative ml-[58px] border-l border-line-strong">
          {events.map((t) => {
            const c = inv.candidates.find((x) => x.id === t.candidateId);
            return (
              <li key={t.id} className="relative mb-4 pl-6">
                <span className="absolute -left-[58px] top-0 w-[46px] text-right font-mono text-[13px] font-semibold">{t.year}</span>
                <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-bg", KIND_COLOR[t.kind] || "bg-white/40")} />
                <div className="rounded-[5px] border border-line bg-panel px-3 py-2">
                  <div className="text-[13px]">{t.label}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-mute">
                    <span>{t.date}</span>
                    <span className="capitalize">{t.kind}</span>
                    {c && <span>{c.name}</span>}
                    {t.userProvided ? <span className="text-warn">user-provided</span> : t.sourceIds.length ? <button className="text-cyan hover:underline" onClick={() => ws.set({ tab: "sources" })}>{t.sourceIds.length} source{t.sourceIds.length > 1 && "s"}</button> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-6 flex flex-wrap gap-2 rounded-card border border-line bg-panel p-3">
        <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="Year or date (e.g. 2018)" className={cn(inputCls, "w-44")} aria-label="Event date" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What happened (user-provided)" className={cn(inputCls, "min-w-[200px] flex-1")} aria-label="Event description" onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}>
          <Plus className="size-4" /> Add event
        </Button>
      </div>
    </div>
  );
}
