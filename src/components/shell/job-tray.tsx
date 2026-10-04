"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ListChecks, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { Progress } from "../ui/misc";

type Job = { id: string; label: string; status: string; progress: number; message: string | null; processed: number; total: number };

/** Shows running background jobs; refreshes the page when one finishes. */
export function JobTray() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const prev = useRef<Set<string>>(new Set());
  const poll = useCallback(async () => {
    const list = await apiFetch<Job[]>("/api/jobs?active=1").catch(() => null);
    if (!list) return;
    const ids = new Set(list.map((j) => j.id));
    const finished = [...prev.current].some((id) => !ids.has(id));
    prev.current = ids;
    setJobs(list);
    if (finished) router.refresh();
  }, [router]);
  useEffect(() => {
    poll();
    const onKick = () => poll();
    window.addEventListener("ws:jobs", onKick);
    const t = setInterval(poll, jobs.length ? 2500 : 15000);
    return () => {
      clearInterval(t);
      window.removeEventListener("ws:jobs", onKick);
    };
  }, [poll, jobs.length]);
  if (!jobs.length) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-accent hover:bg-subtle" aria-expanded={open}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">{jobs.length} running</span>
      </button>
      {open && (
        <div className="fixed inset-x-3 top-14 z-50 rounded-xl border border-border bg-surface p-3 shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-80">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold"><ListChecks className="h-4 w-4" /> Background jobs</span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-faint hover:text-fg"><X className="h-4 w-4" /></button>
          </div>
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="truncate font-medium">{j.label}</span><span className="tabular-nums text-muted">{j.status === "QUEUED" ? "Queued" : `${j.progress}%`}</span></div>
                <Progress value={j.status === "QUEUED" ? 0 : j.progress} label={j.label} />
                {j.message && <p className="mt-1 truncate text-xs text-muted">{j.message}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function kickJobs() {
  window.dispatchEvent(new Event("ws:jobs"));
}
