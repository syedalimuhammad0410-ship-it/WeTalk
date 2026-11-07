"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe2, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { Badge, Card, CardHeader } from "../ui/misc";
import { Button } from "../ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

const TONE: Record<string, any> = { QUEUED: "blue", RUNNING: "blue", PAUSED: "amber", COMPLETED: "green", CANCELLED: "zinc", FAILED: "red" };
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** Large-area discovery: cities, regions, provinces, countries — tiled into zones, resumable. */
export function RegionDiscovery({ googleConfigured, canRun, campaigns, runs, defaultOpen }: { googleConfigured: boolean; canRun: boolean; campaigns: { id: string; name: string }[]; runs: any[]; defaultOpen: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [f, setF] = useState({ locations: "", queries: "", target: "300", maxRequests: "300", coverage: "auto", website: "any", hasPhone: false, smallOnly: true, includeExisting: false, repeatSearches: false, autoAudit: true, campaignId: "", google: googleConfigured, osm: !googleConfigured });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const tick = (k: keyof typeof f) => (v: boolean) => setF((s) => ({ ...s, [k]: v }));
  const live = runs.some((r) => ["QUEUED", "RUNNING"].includes(r.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [live, router]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy("start");
    try {
      await apiFetch("/api/discovery-runs", {
        body: {
          locations: f.locations.split(/\n|;/).map((x) => x.trim()).filter(Boolean), queries: list(f.queries), providers: [f.google && "google_places", f.osm && "openstreetmap"].filter(Boolean),
          target: +f.target, maxRequests: +f.maxRequests, campaignId: f.campaignId || null,
          options: { coverage: f.coverage, website: f.website, hasPhone: f.hasPhone, smallOnly: f.smallOnly, includeExisting: f.includeExisting, repeatSearches: f.repeatSearches, autoAudit: f.autoAudit },
        },
      });
      kickJobs();
      toast.success("Large-area search started", "It runs in the background and survives closing the browser.");
      router.refresh();
    } catch (err) {
      toast.error("Could not start", (err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function control(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(`${id}:${action}`);
    try {
      await apiFetch(`/api/discovery-runs/${id}`, { method: "PATCH", body: { action, ...extra } });
      kickJobs();
      router.refresh();
    } catch (err) {
      toast.error("Action failed", (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-accent" /> Large-area search — cities, regions, provinces, countries</span>} description="No 50 km limit: big areas are split into overlapping zones, busy zones are split further, results from every provider are merged and de-duplicated, and progress is checkpointed so you can pause and continue later." action={!open && <Button size="sm" onClick={() => setOpen(true)} disabled={!canRun}>New large-area search</Button>} />
      {open && (
        <form onSubmit={start} className="grid gap-4 border-b border-border p-5 sm:grid-cols-2">
          <Field label="Locations" htmlFor="rl" required hint="One per line, e.g. “Ontario, Canada”, “Greater Toronto Area”, “Toronto; Mississauga; Brampton”."><Textarea id="rl" value={f.locations} onChange={set("locations")} placeholder={"Ontario, Canada"} className="min-h-[88px]" /></Field>
          <div className="space-y-4">
            <Field label="Categories / keywords" htmlFor="rq" required hint="Comma-separated; each is searched in every zone."><Input id="rq" value={f.queries} onChange={set("queries")} placeholder="commercial cleaning, janitorial services" /></Field>
            <Field label="Coverage" htmlFor="rc"><Select id="rc" value={f.coverage} onChange={set("coverage")}><option value="auto">Automatic</option><option value="local">Local (one search per location)</option><option value="regional">Regional (50 km zones)</option><option value="provincial">Provincial (100 km zones)</option><option value="national">National (200 km zones)</option></Select></Field>
          </div>
          <Field label="Target businesses" htmlFor="rt"><Input id="rt" type="number" min={1} max={20000} value={f.target} onChange={set("target")} /></Field>
          <Field label="Maximum requests" htmlFor="rr" hint={`Google ≈ $0.035 per request (estimate) → up to ≈ $${((+f.maxRequests || 0) * 0.035).toFixed(2)}. OpenStreetMap is free.`}><Input id="rr" type="number" min={1} max={50000} value={f.maxRequests} onChange={set("maxRequests")} /></Field>
          <Field label="Website" htmlFor="rw"><Select id="rw" value={f.website} onChange={set("website")}><option value="any">Any</option><option value="has">Has a website</option><option value="none">No website</option></Select></Field>
          <Field label="Add to campaign" htmlFor="rcm"><Select id="rcm" value={f.campaignId} onChange={set("campaignId")}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <Checkbox checked={f.google} onChange={tick("google")} disabled={!googleConfigured} label={`Google Places${googleConfigured ? "" : " (connect in Settings)"}`} />
            <Checkbox checked={f.osm} onChange={tick("osm")} label="OpenStreetMap (free, © OpenStreetMap contributors)" />
            <Checkbox checked={f.hasPhone} onChange={tick("hasPhone")} label="Has a phone number" />
            <Checkbox checked={f.smallOnly} onChange={tick("smallOnly")} label="Small local businesses only" />
            <Checkbox checked={f.includeExisting} onChange={tick("includeExisting")} label="Include previously discovered (adds them to the campaign)" />
            <Checkbox checked={f.repeatSearches} onChange={tick("repeatSearches")} label="Repeat areas searched in the last 30 days" />
            <Checkbox checked={f.autoAudit} onChange={tick("autoAudit")} label="Analyse new websites automatically" />
          </div>
          <p className="text-xs text-muted sm:col-span-2">Has-email and opportunity filters need contact research and website analysis — use AutoProspect for those, or the “Has public business email” filter on Leads afterwards.</p>
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={busy === "start"} disabled={!canRun || (!f.google && !f.osm)}>Start large-area search</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
        </form>
      )}
      {runs.length > 0 && (
        <ul className="divide-y divide-border">
          {runs.map((r) => (
            <li key={r.id} className="space-y-1.5 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.queries.join(", ")}</span><span className="text-muted">in {r.locations.join("; ")}</span><Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                <span className="ml-auto flex gap-1.5">
                  {["QUEUED", "RUNNING"].includes(r.status) && <Button size="sm" variant="outline" loading={busy === `${r.id}:pause`} onClick={() => control(r.id, "pause")}><Pause className="h-3.5 w-3.5" /> Pause</Button>}
                  {r.status === "PAUSED" && <Button size="sm" loading={busy === `${r.id}:resume`} onClick={() => control(r.id, "resume")}><Play className="h-3.5 w-3.5" /> Resume</Button>}
                  {r.zones.failed > 0 && <Button size="sm" variant="outline" onClick={() => control(r.id, "retry_failed")}><RotateCcw className="h-3.5 w-3.5" /> Retry failed zones</Button>}
                  {["COMPLETED", "PAUSED", "CANCELLED"].includes(r.status) && <Button size="sm" variant="outline" loading={busy === `${r.id}:continue`} onClick={() => control(r.id, "continue", { addTarget: r.target, addRequests: r.maxRequests })}><Plus className="h-3.5 w-3.5" /> Continue discovery</Button>}
                </span>
              </div>
              <div className="text-xs text-muted">{r.found} found ({r.created} new, {r.duplicates} already known, {r.filtered} filtered) · zones {r.zones.done}/{r.zones.total}{r.zones.failed ? ` · ${r.zones.failed} failed` : ""} · {r.requests}/{r.maxRequests} requests · target {r.target}</div>
              {r.message && <div className="text-xs text-faint">{r.message}</div>}
              {r.campaignId && <Link href={`/leads?campaignId=${r.campaignId}`} className="text-xs font-medium text-accent hover:underline">View results →</Link>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
