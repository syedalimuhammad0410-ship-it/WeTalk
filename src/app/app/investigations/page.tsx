"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Download, FolderSearch, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, ConfidenceBadge, Dialog, Empty, Spinner, inputCls } from "@/components/ui";
import type { InvestigationSummary } from "@/lib/types";

export default function Investigations() {
  const [list, setList] = useState<InvestigationSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [del, setDel] = useState<InvestigationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.list().then((r) => setList(r.investigations)).catch((e) => setError(String(e.message || e)));
  useEffect(() => {
    void load();
  }, []);
  const rename = async (s: InvestigationSummary) => {
    const t = window.prompt("Rename investigation", s.title);
    if (!t || t === s.title) return;
    await api.rename(s.id, t.slice(0, 200));
    void load();
  };
  const exportJson = async (s: InvestigationSummary) => {
    const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ investigationId: s.id, format: "json" }) });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await res.blob());
    a.download = `${s.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    a.click();
  };
  const shown = (list || []).filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()) || (s.headline || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <div className="label-mono text-cyan">History</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Investigations</h1>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search investigations…" className={`${inputCls} w-60`} aria-label="Search investigations" />
          <Link href="/app" className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-fg px-3.5 text-[13px] font-medium text-ink">
            <Plus className="size-4" /> New
          </Link>
        </div>
        {error && <div className="mb-3 text-[13px] text-alert">{error}</div>}
        {!list ? (
          <div className="grid place-items-center py-20">
            <Spinner />
          </div>
        ) : !shown.length ? (
          <Empty icon={<FolderSearch className="size-7" />} title="No investigations yet">
            Start one from an image or try an example.
          </Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-panel">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center gap-4 p-3">
                <Link href={`/app/i/${s.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  {s.thumbKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/images/${s.thumbKey}`} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-[3px] object-cover" />
                  ) : (
                    <div className="h-14 w-20 shrink-0 rounded-[3px] bg-white/5" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">
                      {s.title} {s.demo && <span className="label-mono ml-1 !text-[9px] text-warn">demo</span>}
                    </div>
                    <div className="truncate text-[12px] text-dim">{s.headline || "No result yet"}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
                      <ConfidenceBadge value={s.confidence} />
                      <span>
                        {s.imageCount} img · {s.candidateCount} candidates · {s.sourceCount} sources · {s.mode} · updated {new Date(s.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </Link>
                <div className="flex shrink-0 gap-0.5">
                  <Button size="sm" variant="ghost" onClick={() => rename(s)} aria-label="Rename" title="Rename">
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={async () => { await api.duplicate(s.id); void load(); }} aria-label="Duplicate" title="Duplicate">
                    <Copy className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => exportJson(s)} aria-label="Export JSON" title="Export JSON">
                    <Download className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDel(s)} aria-label="Delete" title="Delete">
                    <Trash2 className="size-3.5 text-alert" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={Boolean(del)} onClose={() => setDel(null)} title="Delete investigation?">
        <p className="text-[13.5px] text-dim">
          “{del?.title}” and its uploaded images will be permanently deleted. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDel(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await api.remove(del!.id);
              setDel(null);
              void load();
            }}
          >
            Delete permanently
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
