"use client";
import { useState } from "react";
import { FileJson, FileSpreadsheet, FileText, FileType2, ImageDown, ScrollText } from "lucide-react";
import { Dialog, cn } from "@/components/ui";
import { getState, ws } from "@/lib/client/store";

const FORMATS = [
  { id: "pdf", label: "PDF report", desc: "Cover page, result, map, clues, timeline, candidates, evidence, sources", icon: FileType2 },
  { id: "png", label: "PNG evidence board", desc: "Opens the evidence board, where the PNG button renders the full board", icon: ImageDown },
  { id: "json", label: "JSON", desc: "Full machine-readable investigation", icon: FileJson },
  { id: "csv", label: "CSV", desc: "Candidates, evidence, clues, sources, queries", icon: FileSpreadsheet },
  { id: "md", label: "Markdown", desc: "Readable report with numbered citations", icon: FileText },
  { id: "txt", label: "Text report", desc: "Plain text version of the report", icon: ScrollText },
] as const;

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(f: (typeof FORMATS)[number]["id"]) {
    const inv = getState().inv;
    if (!inv) return;
    setError(null);
    setBusy(f);
    try {
      if (f === "png") {
        ws.set({ tab: "board" });
        onClose();
        return;
      }
      if (f === "pdf") {
        const { exportPdf } = await import("@/lib/client/pdf");
        await exportPdf(inv);
      } else {
        await ws.saveNow();
        const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ investigationId: inv.id, format: f }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
        const blob = await res.blob();
        const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || `investigation.${f}`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      ws.log(`Exported ${f.toUpperCase()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Export investigation">
      <div className="space-y-1.5">
        {FORMATS.map((f) => (
          <button key={f.id} onClick={() => go(f.id)} disabled={Boolean(busy)} className={cn("flex w-full items-center gap-3 rounded-[5px] border border-line px-3 py-2.5 text-left hover:border-cyan/40 hover:bg-white/[0.03]", busy === f.id && "border-cyan/50")}>
            <f.icon className="size-4 shrink-0 text-cyan" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{busy === f.id ? "Preparing…" : f.label}</div>
              <div className="text-[11.5px] text-mute">{f.desc}</div>
            </div>
          </button>
        ))}
      </div>
      {error && <div className="mt-3 rounded border border-alert/30 bg-alert/10 px-3 py-2 text-[12.5px] text-alert">{error}</div>}
    </Dialog>
  );
}
