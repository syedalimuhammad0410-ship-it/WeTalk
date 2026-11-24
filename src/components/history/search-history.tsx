"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Compass, Download, History, Mail, Phone, PlayCircle, Rocket } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "../ui/misc";
import { cn } from "@/lib/utils";

export type HistoryRow = {
  kind: "claude" | "search" | "autoprospect"; id: string; title: string; status: string; createdAt: string; finishedAt: string | null; durationMs: number | null;
  leads: number; withEmail: number; withPhone: number; cities: { name: string; count: number }[]; liveHref: string;
};
export type DayRow = { day: string; leads: number; withEmail: number; withPhone: number };

const KIND = {
  claude: { label: "Claude", icon: Bot },
  search: { label: "Business Finder", icon: Compass },
  autoprospect: { label: "AutoProspect", icon: Rocket },
} as const;
const STATUS_TONE: Record<string, "emerald" | "sky" | "amber" | "zinc" | "red" | "indigo"> = { RUNNING: "emerald", QUEUED: "indigo", COMPLETED: "sky", PAUSED: "amber", CANCELLED: "zinc", FAILED: "red" };
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
const when = (d: string) => new Date(d).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
function duration(ms: number | null) {
  if (ms == null) return "—";
  const m = Math.round(ms / 60000);
  return m < 1 ? "< 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function SearchHistoryView({ rows, days }: { rows: HistoryRow[]; days: DayRow[] }) {
  const [kind, setKind] = useState<"all" | HistoryRow["kind"]>("all");
  const shown = rows.filter((r) => kind === "all" || r.kind === kind);
  const total = rows.reduce((a, r) => a + r.leads, 0);
  const week = days.filter((d) => new Date(`${d.day}T12:00:00`).getTime() > Date.now() - 7 * 86400_000).reduce((a, d) => a + d.leads, 0);
  const today = days.find((d) => d.day === new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }))?.leads ?? 0;
  const last30 = useMemo(() => {
    const map = new Map(days.map((d) => [d.day, d]));
    return Array.from({ length: 30 }, (_, i) => {
      const day = new Date(Date.now() - (29 - i) * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
      return map.get(day) ?? { day, leads: 0, withEmail: 0, withPhone: 0 };
    });
  }, [days]);
  const max = Math.max(1, ...last30.map((d) => d.leads));
  const [hover, setHover] = useState<DayRow | null>(null);

  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Date", "Search", "Type", "Status", "Leads found", "With email", "With phone", "Cities", "Duration"].join(","), ...rows.map((r) => [when(r.createdAt), r.title, KIND[r.kind].label, r.status, r.leads, r.withEmail, r.withPhone, r.cities.map((c) => `${c.name} (${c.count})`).join("; "), duration(r.durationMs)].map(q).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `webscout-search-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div>
      <PageHeader title="Search History" description="Every lead search you've run — when it ran, what it found, and a replay of the businesses appearing on the map that you can save as a video or photo." actions={<button onClick={exportCsv} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-subtle"><Download className="h-4 w-4" /> History (CSV)</button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[{ l: "Searches", v: rows.length }, { l: "Leads found (all searches)", v: total }, { l: "Leads found this week", v: week }, { l: "Leads found today", v: today }].map((s) => (
          <Card key={s.l} className="p-4"><div className="text-[13px] text-muted">{s.l}</div><div className="mt-1 text-[26px] font-semibold tabular-nums">{s.v.toLocaleString()}</div></Card>
        ))}
      </div>

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">New leads per day</h2>
          <span className="text-xs text-muted">{hover ? `${dayLabel(hover.day)}: ${hover.leads} leads · ${hover.withEmail} with email · ${hover.withPhone} with phone` : "Last 30 days — hover a bar for details"}</span>
        </div>
        <div className="flex h-40 items-end gap-[3px]" onMouseLeave={() => setHover(null)} role="img" aria-label={`New leads per day, last 30 days. Busiest day: ${Math.max(...last30.map((d) => d.leads))}.`}>
          {last30.map((d) => (
            <div key={d.day} className="group flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(d)} title={`${dayLabel(d.day)}: ${d.leads} leads`}>
              {d.leads === max && d.leads > 0 && <div className="mb-1 text-center text-[11px] font-medium tabular-nums text-muted">{d.leads}</div>}
              <div className={cn("w-full rounded-t-[4px] bg-accent transition-opacity", hover && hover.day !== d.day ? "opacity-40" : "opacity-90")} style={{ height: `${d.leads ? Math.max(3, (d.leads / max) * 100) : 0}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-faint"><span>{dayLabel(last30[0]!.day)}</span><span>Today</span></div>
      </Card>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["all", "claude", "search", "autoprospect"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", kind === k ? "border-accent bg-accent text-white" : "border-border text-muted hover:text-fg")}>
            {k === "all" ? `All searches ${rows.length}` : `${KIND[k].label} ${rows.filter((r) => r.kind === k).length}`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card><EmptyState icon={<History className="h-5 w-5" />} title="No searches yet" description="Run a search with Claude, the Business Finder or AutoProspect and it will be recorded here." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-subtle/60 text-left text-xs text-muted">
              <tr><th className="px-4 py-2.5 font-medium">When</th><th className="px-2 py-2.5 font-medium">Search</th><th className="px-2 py-2.5 text-right font-medium">Leads</th><th className="px-2 py-2.5 text-right font-medium">Email / phone</th><th className="px-2 py-2.5 font-medium">Cities</th><th className="px-2 py-2.5 font-medium">Took</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const K = KIND[r.kind];
                return (
                  <tr key={`${r.kind}-${r.id}`} className="border-b border-border/60 last:border-0 hover:bg-subtle/40">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{when(r.createdAt)}</td>
                    <td className="max-w-[340px] px-2 py-3">
                      <div className="flex items-center gap-2"><K.icon className="h-4 w-4 shrink-0 text-faint" /><span className="truncate font-medium" title={r.title}>{r.title}</span></div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">{K.label}<Badge tone={STATUS_TONE[r.status] ?? "slate"}>{r.status.toLowerCase()}</Badge></div>
                    </td>
                    <td className="px-2 py-3 text-right text-base font-semibold tabular-nums">{r.leads.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right text-xs tabular-nums text-muted"><span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{r.withEmail}</span> · <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{r.withPhone}</span></td>
                    <td className="max-w-[220px] truncate px-2 py-3 text-xs text-muted" title={r.cities.map((c) => `${c.name} (${c.count})`).join(", ")}>{r.cities.slice(0, 3).map((c) => c.name).join(", ") || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-xs text-muted">{r.status === "RUNNING" ? "running…" : duration(r.durationMs)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link href={`/history/${r.kind}/${r.id}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:border-faint hover:bg-subtle"><PlayCircle className="h-3.5 w-3.5" /> Replay · video · photo</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
