"use client";
import { useState } from "react";
import { ChevronDown, ExternalLink, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Button, Empty, cn, inputCls } from "@/components/ui";
import type { SearchQuery } from "@/lib/types";

const STATUS: Record<SearchQuery["status"], string> = {
  ok: "text-ok",
  empty: "text-mute",
  error: "text-alert",
  not_configured: "text-warn",
  skipped: "text-mute",
  pending: "text-cyan",
};

export function QueriesView() {
  const inv = useWorkspace((s) => s.inv)!;
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState("web");
  const [text, setText] = useState("");
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const branches = Array.from(new Set(inv.queries.map((q) => q.branch)));
  const rerunKind = (q: SearchQuery) => (q.kind === "knowledge" ? "web" : q.kind === "reverse-image" ? "images" : q.kind);
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4">
        <h2 className="text-[16px] font-semibold">Search queries</h2>
        <p className="text-[12px] text-mute">Every query TRACE ran, grouped by research branch, with its provider and outcome. Nothing is hidden or simulated.</p>
      </div>
      <div className="mb-5 flex flex-wrap gap-2 rounded-card border border-line bg-panel p-3">
        <select aria-label="Search type" value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-[5px] border border-line-strong bg-black/30 px-2 text-[13px]">
          {["web", "news", "videos", "images", "history", "maps"].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim().length > 1 && (ws.search(kind, text.trim(), { userAdded: true }), setText(""))} placeholder="Add query…" className={cn(inputCls, "min-w-[220px] flex-1")} aria-label="New query" />
        <Button
          variant="primary"
          disabled={text.trim().length < 2}
          onClick={() => {
            void ws.search(kind, text.trim(), { userAdded: true });
            setText("");
          }}
        >
          <Plus className="size-4" /> Add query
        </Button>
      </div>
      {!inv.queries.length && <Empty icon={<Search className="size-7" />} title="No queries yet" />}
      {branches.map((b) => (
        <section key={b} className="mb-5">
          <div className="label-mono mb-2 text-cyan">Branch · {b}</div>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-panel">
            {inv.queries
              .filter((q) => q.branch === b)
              .map((q) => {
                const results = inv.results.filter((r) => r.queryId === q.id);
                return (
                  <li key={q.id}>
                    <div className="flex items-center gap-3 px-3 py-2">
                      <button onClick={() => setOpen(open === q.id ? null : q.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open === q.id}>
                        <ChevronDown className={cn("size-3.5 shrink-0 text-mute transition-transform", open !== q.id && "-rotate-90")} />
                        {edit?.id === q.id ? (
                          <input autoFocus value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
                            if (e.key === "Enter" && edit.text.trim().length > 1) {
                              void ws.search(rerunKind(q), edit.text.trim(), { userAdded: true, branch: q.branch });
                              setEdit(null);
                            }
                            if (e.key === "Escape") setEdit(null);
                          }} className={cn(inputCls, "h-7")} aria-label="Modify query" />
                        ) : (
                          <span className="truncate font-mono text-[12.5px]">“{q.text}”</span>
                        )}
                      </button>
                      <span className="hidden shrink-0 text-[11px] text-mute sm:inline">
                        {q.kind} · {q.provider}
                        {q.cached ? " · cached" : ""}
                        {q.userAdded ? " · you" : ""}
                      </span>
                      <span className={cn("label-mono shrink-0 !text-[9.5px]", STATUS[q.status])}>
                        {q.status.replace("_", " ")} {q.resultCount ? `· ${q.resultCount}` : ""}
                      </span>
                      <button title="Search again" aria-label="Search again" onClick={() => ws.search(rerunKind(q), q.text, { branch: q.branch })} className="rounded p-1 text-mute hover:text-fg">
                        <RefreshCw className="size-3.5" />
                      </button>
                      <button title="Modify query" aria-label="Modify query" onClick={() => setEdit({ id: q.id, text: q.text })} className="rounded p-1 text-mute hover:text-fg">
                        <Pencil className="size-3.5" />
                      </button>
                    </div>
                    {open === q.id && (
                      <div className="border-t border-line bg-black/20 px-9 py-2.5">
                        {q.error && <div className="mb-2 text-[12px] text-warn">{q.error}</div>}
                        {!results.length && !q.error && <div className="text-[12px] text-mute">No result rows recorded for this query.</div>}
                        <ul className="space-y-2">
                          {results.map((r) => (
                            <li key={r.id} className="text-[12.5px]">
                              <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg hover:text-cyan">
                                {r.title} <ExternalLink className="size-3 text-mute" />
                              </a>
                              {r.snippet && <div className="text-[12px] text-dim">{r.snippet}</div>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
