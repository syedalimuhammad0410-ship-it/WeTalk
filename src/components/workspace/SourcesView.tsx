"use client";
import { useMemo, useState } from "react";
import { BookMarked, Bookmark, BookmarkCheck, Copy, ExternalLink, HelpCircle, Network, ShieldAlert, ShieldCheck } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Button, Empty, Label, cn, inputCls } from "@/components/ui";
import type { Source, SourceCategory } from "@/lib/types";
import { buildBoard } from "@/lib/engine/graph";

const ORDER: SourceCategory[] = ["official", "maps", "news", "sports", "images", "videos", "government", "reference", "user", "other"];

export function SourcesView() {
  const inv = useWorkspace((s) => s.inv)!;
  const [filter, setFilter] = useState<"all" | "used" | "saved" | "unverified">("all");
  const [q, setQ] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  const list = useMemo(
    () =>
      inv.sources.filter(
        (s) =>
          (filter === "all" || (filter === "used" && s.usedInReasoning) || (filter === "saved" && s.saved) || (filter === "unverified" && !s.verified)) &&
          (!q || `${s.title} ${s.publisher} ${s.url} ${s.excerpt}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [inv.sources, filter, q],
  );
  if (!inv.sources.length) return <Empty icon={<BookMarked className="size-7" />} title="No sources yet">Every factual claim TRACE makes is tied to a retrieved source. Sources appear as research runs.</Empty>;
  const groups = ORDER.map((cat) => [cat, list.filter((s) => s.category === cat)] as const).filter(([, l]) => l.length);
  const claimsFor = (s: Source) => {
    const ev = inv.evidence.filter((e) => e.sourceIds.includes(s.id));
    return ev.map((e) => e.statement);
  };
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-[16px] font-semibold">Sources</h2>
          <p className="text-[12px] text-mute">
            {inv.sources.length} collected · {inv.sources.filter((s) => s.usedInReasoning).length} used in reasoning · {inv.sources.filter((s) => !s.verified).length} listed but not fetched
          </p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter sources…" className={cn(inputCls, "h-8 w-48")} aria-label="Filter sources" />
        {(["all", "used", "saved", "unverified"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "subtle" : "ghost"} onClick={() => setFilter(f)}>
            {f === "used" ? "Used in reasoning" : f[0].toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>
      {groups.map(([cat, items]) => (
        <section key={cat} className="mb-6">
          <Label className="mb-2">
            {cat} · {items.length}
          </Label>
          <ul className="space-y-2">
            {items.map((s) => (
              <li key={s.id} id={`source-${s.id}`} className="rounded-card border border-line bg-panel p-3.5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium hover:text-cyan">
                      {s.title}
                    </a>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-mute">{s.url}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-dim">
                      <span>{s.publisher}</span>
                      {s.publishedAt && <span>published {s.publishedAt.slice(0, 10)}</span>}
                      <span>accessed {s.accessedAt.slice(0, 10)}</span>
                      <span>via {s.provider}</span>
                      <span className="capitalize">{s.type.replace("-", " ")}</span>
                      <span className={cn("inline-flex items-center gap-1", s.verified ? "text-ok" : "text-warn")}>
                        {s.verified ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
                        {s.verified ? "retrieved by TRACE" : "not fetched / unverified"}
                      </span>
                      <span>reliability: {s.reliability.tier}</span>
                      <span className={s.usedInReasoning ? "text-cyan" : "text-mute"}>Used in reasoning: {s.usedInReasoning ? "YES" : "NO"}</span>
                    </div>
                    {s.excerpt && <p className="mt-2 border-l-2 border-line-strong pl-2.5 text-[12.5px] leading-relaxed text-dim">{s.excerpt}</p>}
                    {s.supports.length > 0 && (
                      <div className="mt-2 text-[11.5px] text-mute">
                        Supports: <span className="text-dim">{s.supports.slice(0, 4).join(" · ")}</span>
                      </div>
                    )}
                    {why === s.id && (
                      <div className="mt-2 rounded-[4px] bg-white/[0.04] p-2.5 text-[12px] leading-relaxed">
                        <div className="mb-1 text-dim">{s.why || "Retrieved during research."}</div>
                        <div className="text-mute">{s.reliability.note}</div>
                        {claimsFor(s).length > 0 && (
                          <ul className="mt-1.5 list-inside list-disc text-dim">
                            {claimsFor(s).slice(0, 5).map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] text-dim hover:bg-white/5 hover:text-fg">
                    <ExternalLink className="size-3.5" /> Open Source
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(s.url).then(() => ws.log("URL copied."))}>
                    <Copy className="size-3.5" /> Copy URL
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => ws.update((i) => ({ ...i, sources: i.sources.map((x) => (x.id === s.id ? { ...x, saved: !x.saved } : x)) }))}>
                    {s.saved ? <BookmarkCheck className="size-3.5 text-cyan" /> : <Bookmark className="size-3.5" />} {s.saved ? "Saved" : "Save Source"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      ws.update((i) => {
                        const next = { ...i, sources: i.sources.map((x) => (x.id === s.id ? { ...x, saved: true } : x)) };
                        return { ...next, boards: [buildBoard(next, next.boards[0]), ...next.boards.slice(1)] };
                      })
                    }
                  >
                    <Network className="size-3.5" /> Add to Evidence Board
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setWhy(why === s.id ? null : s.id)}>
                    <HelpCircle className="size-3.5" /> Why was this source used?
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
