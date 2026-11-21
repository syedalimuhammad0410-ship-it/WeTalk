"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Map as MapIcon, Pause, Play, RotateCcw } from "lucide-react";
import { Button, ButtonLink } from "../ui/button";
import { Alert, Card, CardHeader, Progress, Stat } from "../ui/misc";
import { RelTime } from "../ui/time";
import { useToast } from "../ui/toast";
import { LiveMap, type MapPoint } from "../map/live-map";
import { apiFetch } from "@/lib/client";
import { type ClaudeEvent, type ClaudeTask, CopyButton, EventRow, sayToClaude, shortId, TaskStatusBadge } from "./shared";

type Data = { task: ClaudeTask; events: ClaudeEvent[]; points: (MapPoint & { status?: string })[] };

/** One Claude task: live progress, map of what it found, the event timeline and controls. */
export function TaskView({ initial, canControl }: { initial: Data; canControl: boolean }) {
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const t = d.task;
  const active = ["QUEUED", "RUNNING"].includes(t.status);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const n = await apiFetch<Data>(`/api/claude/tasks/${t.id}`);
        if (alive) setD(n);
      } catch {
        /* keep showing the last state */
      }
    };
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active, t.id]);

  async function control(action: "pause" | "resume" | "cancel" | "retry") {
    setBusy(action);
    try {
      await apiFetch(`/api/claude/tasks/${t.id}`, { method: "PATCH", body: { action } });
      setD(await apiFetch<Data>(`/api/claude/tasks/${t.id}`));
    } catch (e) {
      toast.error("Not changed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const s = t.stats ?? {};
  return (
    <div className="space-y-5">
      <Link href="/claude" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Claude Command Centre</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{t.title}</h1><TaskStatusBadge status={t.status} /></div>
          <div className="mt-1 text-sm text-muted">Task #{shortId(t.id)} · created <RelTime d={t.createdAt} />{t.finishedAt ? <> · finished <RelTime d={t.finishedAt} /></> : null}</div>
        </div>
        {(
          <div className="flex flex-wrap gap-2">
            <ButtonLink size="sm" href={`/claude/live/${t.id}`}><MapIcon className="h-4 w-4" /> Open live view</ButtonLink>
            {canControl && active && <Button size="sm" variant="outline" onClick={() => control("pause")} loading={busy === "pause"}><Pause className="h-4 w-4" /> Pause</Button>}
            {canControl && t.status === "PAUSED" && <Button size="sm" onClick={() => control("resume")} loading={busy === "resume"}><Play className="h-4 w-4" /> Resume</Button>}
            {canControl && ["QUEUED", "RUNNING", "PAUSED"].includes(t.status) && <Button size="sm" variant="ghost" onClick={() => control("cancel")} loading={busy === "cancel"}><Ban className="h-4 w-4" /> Cancel</Button>}
            {canControl && ["FAILED", "CANCELLED"].includes(t.status) && <Button size="sm" variant="outline" onClick={() => control("retry")} loading={busy === "retry"}><RotateCcw className="h-4 w-4" /> Run again</Button>}
          </div>
        )}
      </div>

      {t.status === "QUEUED" && (
        <Alert tone="info" title="Waiting for Claude">
          <div className="mt-1 flex flex-wrap items-center gap-2">In Claude, with the WebScout connector on, say <code className="rounded bg-subtle px-1.5 py-0.5 font-mono">{sayToClaude(t.id)}</code><CopyButton text={sayToClaude(t.id)} /></div>
        </Alert>
      )}
      {t.status === "PAUSED" && <Alert tone="warning" title="Paused">Claude is refused further work on this task until you resume it. {t.progressMessage}</Alert>}
      {t.status === "FAILED" && t.error && <Alert tone="danger" title="Claude stopped">{t.error}</Alert>}
      {t.status === "COMPLETED" && t.summary && <Alert tone="success" title="Claude's summary">{t.summary}</Alert>}

      <Card className="p-5">
        <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">{t.progressMessage ?? "—"}</span><span className="tabular-nums text-muted">{t.progress}%</span></div>
        <Progress value={t.progress} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="New leads" value={s.created ?? 0} />
          <Stat label="Already in CRM" value={s.duplicates ?? 0} />
          <Stat label="Rejected" value={s.rejected ?? 0} hint="Missing sources or not a small business" />
          <Stat label="Emails verified" value={s.contactsVerified ?? 0} />
          <Stat label="Facts recorded" value={s.facts ?? 0} />
          <Stat label="Drafts to review" value={s.drafts ?? 0} />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader title="Map" description="Pins drop in as Claude finds each business." />
          <div className="p-4 pt-0"><LiveMap points={d.points} live={t.status === "RUNNING"} height={460} emptyText="Waiting for the first business…" /></div>
        </Card>
        <Card>
          <CardHeader title="Timeline" description={active ? "Live" : "Everything that happened"} />
          <ul className="max-h-[480px] overflow-y-auto px-5 pb-4 scrollbar-thin">{d.events.map((e) => <EventRow key={e.id} e={e} />)}</ul>
        </Card>
      </div>

      {d.points.length > 0 && (
        <Card>
          <CardHeader title="Businesses" description="Found, checked or researched in this task" />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Business</th><th>Location</th><th>Website</th><th>Phone</th><th>Score</th></tr></thead>
              <tbody>
                {d.points.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/leads/${p.id}`} className="font-medium hover:underline">{p.name}</Link>{p.category && <div className="text-xs text-muted">{p.category}</div>}</td>
                    <td className="text-sm text-muted">{p.city ?? "—"}</td>
                    <td className="max-w-[220px] truncate text-sm">{p.website ? <a href={p.website} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{p.website.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="text-muted">None found</span>}</td>
                    <td className="whitespace-nowrap text-sm">{p.phone ?? "—"}</td>
                    <td className="text-sm tabular-nums">{p.score ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
