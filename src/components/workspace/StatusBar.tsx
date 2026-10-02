"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, ChevronUp, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { useWorkspace } from "@/lib/client/store";
import { cn } from "@/components/ui";

export function StatusBar() {
  const inv = useWorkspace((s) => s.inv);
  const running = useWorkspace((s) => s.running);
  const steps = useWorkspace((s) => s.steps);
  const logs = useWorkspace((s) => s.logs);
  const [open, setOpen] = useState(false);
  if (!inv) return null;
  const strongVisual = inv.candidates.flatMap((c) => c.images).filter((i) => i.comparison && ["strong", "moderate"].includes(i.comparison.overall)).length;
  const lead = inv.candidates.find((c) => c.status === "leading");
  const current = [...steps].reverse().find((s) => s.status === "running");
  const counters: [number | string, string][] = [
    [inv.sources.length, "sources found"],
    [inv.clues.filter((c) => !c.ignored).length, "clues"],
    [inv.candidates.length, "candidate locations"],
    [strongVisual, "strong visual matches"],
    [inv.contradictions.length, "contradictions"],
    [lead ? 1 : 0, "likely location"],
  ];
  return (
    <div className="relative z-20 border-t border-line bg-panel">
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 260 }} exit={{ height: 0 }} className="overflow-hidden border-b border-line">
            <div className="grid h-[260px] grid-cols-1 md:grid-cols-2">
              <div className="overflow-y-auto border-r border-line p-3">
                <div className="label-mono mb-2 text-mute">Live investigation status</div>
                {!steps.length && <div className="text-[12px] text-mute">No run in this session yet.</div>}
                <ul className="space-y-1">
                  {steps.map((s) => (
                    <li key={s.id} className="flex items-start gap-2 text-[12px]">
                      <StepIcon status={s.status} />
                      <div className="min-w-0">
                        <div className={cn(s.status === "running" ? "text-fg" : "text-dim")}>{s.label}</div>
                        {s.detail && <div className="truncate text-[11px] text-mute">{s.detail}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="overflow-y-auto p-3 font-mono text-[11px]">
                <div className="label-mono mb-2 text-mute">Activity log</div>
                {logs.map((l, i) => (
                  <div key={i} className={cn("leading-relaxed", l.level === "error" ? "text-alert" : l.level === "warn" ? "text-warn" : "text-dim")}>
                    <span className="text-mute">{l.at.slice(11, 19)}</span> {l.text}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-4 overflow-x-auto px-4 py-2 text-left" aria-expanded={open} aria-label="Investigation status">
        <span className="flex shrink-0 items-center gap-2 text-[12px]">
          {running ? <Loader2 className="size-3.5 animate-spin text-cyan" /> : <Circle className={cn("size-2.5", inv.conclusion ? "fill-ok text-ok" : "fill-mute text-mute")} />}
          <span className="max-w-[260px] truncate text-dim">{running ? current?.label || "Working…" : inv.conclusion ? "Investigation complete" : "Ready"}</span>
        </span>
        <span className="h-4 w-px shrink-0 bg-line" />
        {counters.map(([n, l]) => (
          <span key={l} className="flex shrink-0 items-baseline gap-1.5 text-[12px]">
            <motion.span key={String(n)} initial={{ opacity: 0.3, y: -3 }} animate={{ opacity: 1, y: 0 }} className={cn("font-mono font-semibold", l === "contradictions" && Number(n) > 0 ? "text-warn" : "text-fg")}>
              {n}
            </motion.span>
            <span className="text-mute">{l}</span>
          </span>
        ))}
        <span className="flex-1" />
        <ChevronUp className={cn("size-4 shrink-0 text-mute transition-transform", !open && "rotate-180")} />
      </button>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-cyan" />;
  if (status === "done") return <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />;
  if (status === "error") return <XCircle className="mt-0.5 size-3.5 shrink-0 text-alert" />;
  if (status === "skipped") return <MinusCircle className="mt-0.5 size-3.5 shrink-0 text-mute" />;
  return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />;
}
