"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Inbox, Search, Send, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { Badge, Card } from "../ui/misc";
import { Field, Input, Switch, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

type Run = { id: string; name: string; status: string; total: number; sent: number; failed: number; skipped: number; createdAt: string; nextSendAt: string | null };
type SearchRow = { id: string; name: string; status: string; createdAt: string; finishedAt: string | null; message: string | null; found: number; withEmail: number; cleared: number };
export type ScheduleData = {
  schedule: { enabled: boolean; perDay: number; startTime: string; endTime: string; weekdaysOnly: boolean; searchMinutes: number; locations: string[]; categories: string[]; maxRequests: number; message: string | null; nextAt: string | null; lastBatchDay: string | null };
  pool: number;
  needsReview: number;
  daysLeft: number | null;
  nextBatch: { day: string; start: string; end: string } | null;
  runs: Run[];
  searches: SearchRow[];
};

const STATUS: Record<string, { label: string; tone: "emerald" | "sky" | "amber" | "zinc" | "indigo" | "red" }> = {
  QUEUED: { label: "Starting", tone: "indigo" },
  RUNNING: { label: "Running", tone: "emerald" },
  PAUSED: { label: "Paused", tone: "amber" },
  COMPLETED: { label: "Done", tone: "sky" },
  CANCELLED: { label: "Stopped", tone: "zinc" },
  FAILED: { label: "Failed", tone: "red" },
};
const TZ = "America/Toronto";
const at = (d: string) => new Date(d).toLocaleString("en-CA", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const time = (d: string) => new Date(d).toLocaleTimeString("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
/** "16:30" → "4:30 PM" */
const ampm = (t: string) => { const [h, m] = t.split(":").map(Number) as [number, number]; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const lines = (v: string) => v.split(/\n|,|;/).map((x) => x.trim()).filter((x) => x.length >= 2);

export function ScheduleView({ initial, canManage }: { initial: ScheduleData; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initial);
  const s = state.schedule;
  const [f, setF] = useState({
    enabled: s.enabled, perDay: String(s.perDay), startTime: s.startTime, endTime: s.endTime, weekdaysOnly: s.weekdaysOnly,
    searchMinutes: String(s.searchMinutes), locations: s.locations.join("\n"), categories: s.categories.join("\n"), maxRequests: String(s.maxRequests),
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save(over: Partial<typeof f> = {}) {
    const v = { ...f, ...over };
    setBusy(true);
    try {
      const next = await apiFetch<ScheduleData>("/api/emails/schedule", {
        method: "PUT",
        body: { enabled: v.enabled, perDay: Number(v.perDay), startTime: v.startTime, endTime: v.endTime, weekdaysOnly: v.weekdaysOnly, searchMinutes: Number(v.searchMinutes), locations: lines(v.locations), categories: lines(v.categories), maxRequests: Number(v.maxRequests) },
      });
      setState(next);
      setF(v);
      toast.success(v.enabled ? "Schedule saved and on" : "Schedule saved (off)");
      router.refresh();
    } catch (e) {
      toast.error("Not saved", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const perDay = Number(f.perDay) || 0;
  const catCount = lines(f.categories).length;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-accent" />
              <h2 className="text-[17px] font-semibold">Daily schedule</h2>
              <Badge tone={s.enabled ? "emerald" : "zinc"} dot>{s.enabled ? "On" : "Off"}</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Emails {s.perDay} cleared {s.perDay === 1 ? "lead" : "leads"} a day{s.weekdaysOnly ? " on weekdays" : ""}, spread between {ampm(s.startTime)} and {ampm(s.endTime)} (Toronto time), until none are left. When fewer than {s.perDay} are left, it searches for new leads for {s.searchMinutes} minutes, and keeps going.
            </p>
          </div>
          {canManage && <Switch checked={f.enabled} disabled={busy} onChange={(v) => { set("enabled", v); void save({ enabled: v }); }} label={f.enabled ? "On" : "Off"} />}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted"><Send className="h-3.5 w-3.5" /> Next batch</div>
            <div className="mt-1 text-sm font-medium" suppressHydrationWarning>{s.enabled && state.nextBatch ? `${at(state.nextBatch.start)} – ${time(state.nextBatch.end)}` : "—"}</div>
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted"><Inbox className="h-3.5 w-3.5" /> Cleared leads waiting</div>
            <div className="mt-1 text-sm"><span className="text-[22px] font-semibold tabular-nums">{state.pool}</span> <span className="text-muted">{state.daysLeft != null && state.pool > 0 ? `≈ ${Math.max(1, state.daysLeft)} ${state.daysLeft === 1 ? "day" : "days"} of emails` : "a search starts at the next batch"}</span></div>
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" /> Not emailed by the schedule</div>
            <div className="mt-1 text-sm"><span className="text-[22px] font-semibold tabular-nums">{state.needsReview}</span> <span className="text-muted">need a consent review first</span></div>
          </div>
        </div>
        {s.message && <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-[13px] text-muted">{s.message}</p>}
      </Card>

      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">Settings</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label="Emails per day" htmlFor="sp"><Input id="sp" type="number" min={1} max={500} value={f.perDay} disabled={!canManage} onChange={(e) => set("perDay", e.target.value)} /></Field>
          <Field label="Start sending at" htmlFor="ss" hint="Toronto time"><Input id="ss" type="time" value={f.startTime} disabled={!canManage} onChange={(e) => set("startTime", e.target.value)} /></Field>
          <Field label="Finish by" htmlFor="se" hint="Emails are spread evenly in between"><Input id="se" type="time" value={f.endTime} disabled={!canManage} onChange={(e) => set("endTime", e.target.value)} /></Field>
          <div className="flex items-end pb-1"><Switch checked={f.weekdaysOnly} disabled={!canManage} onChange={(v) => set("weekdaysOnly", v)} label="Weekdays only" /></div>
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-1.5 text-sm font-medium"><Search className="h-4 w-4 text-muted" /> Finding new leads</div>
          <p className="mt-1 text-xs text-muted">When fewer than {perDay || "a day's worth of"} cleared leads are left, the schedule searches these cities for these kinds of businesses, keeps the ones with a website, and looks up their public business email. Each search skips areas it searched in the last 30 days.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-4">
            <Field label="Minutes per search" htmlFor="sm" hint="0 = don't search"><Input id="sm" type="number" min={0} max={240} value={f.searchMinutes} disabled={!canManage} onChange={(e) => set("searchMinutes", e.target.value)} /></Field>
            <Field label="Max requests per search" htmlFor="sr" hint="Google Places charges past its free monthly use; keep this low"><Input id="sr" type="number" min={1} max={2000} value={f.maxRequests} disabled={!canManage} onChange={(e) => set("maxRequests", e.target.value)} /></Field>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Cities (one per line)" htmlFor="sl"><Textarea id="sl" rows={6} value={f.locations} disabled={!canManage} onChange={(e) => set("locations", e.target.value)} /></Field>
            <Field label="Business types (one per line)" htmlFor="sc" hint={catCount > 25 ? `Only the first 25 of ${catCount} are used.` : `${catCount} of up to 25`}><Textarea id="sc" rows={6} value={f.categories} disabled={!canManage} onChange={(e) => set("categories", e.target.value)} /></Field>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">Only leads cleared for contact under Canada&apos;s anti-spam law are emailed, each with your mailing address and an unsubscribe line. Emails take turns across your inboxes and count toward each inbox&apos;s daily cap, and so do follow-ups, so add inboxes if you want more than one inbox&apos;s cap a day. A batch that isn&apos;t finished by the end of the window carries over to the next day.</p>
        {canManage ? (
          <div className="mt-4 flex justify-end"><Button loading={busy} onClick={() => save()}>Save schedule</Button></div>
        ) : (
          <p className="mt-4 text-xs text-muted">Only workspace owners and admins can change the schedule.</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-[15px] font-semibold">Daily batches</h3>
          {state.runs.length === 0 ? <p className="mt-2 text-sm text-muted">None yet. The first one starts at the next sending window.</p> : (
            <ul className="mt-2 divide-y divide-border">
              {state.runs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Link href={`/emails/runs/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{r.name}</Link>
                  <span className="shrink-0 tabular-nums text-muted">{r.sent} of {r.total} sent</span>
                  <Badge tone={STATUS[r.status]?.tone ?? "zinc"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="text-[15px] font-semibold">Lead searches</h3>
          {state.searches.length === 0 ? <p className="mt-2 text-sm text-muted">None yet. One starts when fewer than {s.perDay} cleared leads are left.</p> : (
            <ul className="mt-2 divide-y divide-border">
              {state.searches.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Link href={`/autoprospect/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{r.name}</Link>
                  <span className="shrink-0 tabular-nums text-muted">{r.found} found · {r.withEmail} with email</span>
                  <Badge tone={STATUS[r.status]?.tone ?? "zinc"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
