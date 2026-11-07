"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, Pause, Play, Plus, RotateCcw, Search } from "lucide-react";
import { Alert, Badge, Card, CardHeader } from "../ui/misc";
import { Button, ButtonLink } from "../ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

const TONE: Record<string, any> = { QUEUED: "blue", RUNNING: "blue", PAUSED: "amber", COMPLETED: "green", CANCELLED: "zinc", FAILED: "red" };
const RADII = [5, 10, 25, 50, 100, 150, 200, 300, 500];
const POPULAR = ["Plumbers", "Electricians", "HVAC contractors", "Roofers", "Landscapers", "Cleaning services", "Commercial cleaning", "Hair salons", "Barbershops", "Nail salons", "Restaurants", "Cafés", "Bakeries", "Auto repair", "Dentists", "Chiropractors", "Physiotherapy", "General contractors", "Painters", "Movers", "Pet grooming", "Daycares", "Tutoring", "Florists", "Photographers", "Accountants", "Law offices", "Fitness studios"];
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** Business Finder: radius up to 500 km or a whole city/region/province/country, many categories, thousands of results. */
export function BusinessFinder({ googleConfigured, canRun, campaigns, runs, defaultCampaignId }: { googleConfigured: boolean; canRun: boolean; campaigns: { id: string; name: string }[]; runs: any[]; defaultCampaignId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [f, setF] = useState({
    locations: "", radius: "50", queries: "", target: "500", maxRequests: "300", coverage: "auto", website: "any", minRating: "0",
    hasPhone: false, smallOnly: true, includeExisting: false, repeatSearches: false, autoAudit: true, findEmails: true, campaignId: defaultCampaignId,
    google: googleConfigured, osm: !googleConfigured,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const tick = (k: keyof typeof f) => (v: boolean) => setF((s) => ({ ...s, [k]: v }));
  const chosen = list(f.queries);
  const toggleCat = (c: string) => setF((s) => { const cur = list(s.queries); return { ...s, queries: (cur.some((x) => x.toLowerCase() === c.toLowerCase()) ? cur.filter((x) => x.toLowerCase() !== c.toLowerCase()) : [...cur, c]).join(", ") }; });
  const live = runs.some((r) => ["QUEUED", "RUNNING"].includes(r.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [live, router]);
  const estimate = useMemo(() => {
    const radius = Number(f.radius);
    const area = radius > 0 ? Math.PI * radius * radius : null;
    return { dollars: f.google ? (Number(f.maxRequests) || 0) * 0.035 : 0, area };
  }, [f.radius, f.maxRequests, f.google]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy("start");
    try {
      await apiFetch("/api/discovery-runs", {
        body: {
          locations: f.locations.split(/\n|;/).map((x) => x.trim()).filter(Boolean), queries: chosen, providers: [f.google && "google_places", f.osm && "openstreetmap"].filter(Boolean),
          target: +f.target, maxRequests: +f.maxRequests, campaignId: f.campaignId || null,
          options: { radiusKm: +f.radius, coverage: f.coverage, website: f.website, minRating: +f.minRating, hasPhone: f.hasPhone, smallOnly: f.smallOnly, includeExisting: f.includeExisting, repeatSearches: f.repeatSearches, autoAudit: f.autoAudit, findEmails: f.findEmails },
        },
      });
      kickJobs();
      toast.success("Business search started", "It runs in the background — results appear in Leads as they're found.");
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
    <div className="space-y-5">
      {!googleConfigured && <Alert tone="info" title="Google Places isn't connected">You can still search free OpenStreetMap data. For the most complete results, add a Google Places key in <Link href="/settings/integrations" className="font-medium underline">Settings → Business Discovery & AI keys</Link>.</Alert>}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Compass className="h-4 w-4 text-accent" /> Business Finder</span>} description="Search a radius of up to 500 km — or an entire city, region, province or country. Big areas are split into overlapping zones automatically, so you get far more than one search's 60 results." action={<ButtonLink size="sm" variant="outline" href="/autoprospect">Full AutoProspect →</ButtonLink>} />
        <form onSubmit={start} className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Where" htmlFor="bf-l" required hint="One location per line, e.g. “Mississauga, ON”, “Greater Toronto Area”, “Ontario, Canada”."><Textarea id="bf-l" value={f.locations} onChange={set("locations")} placeholder={"Mississauga, Ontario\nBrampton, Ontario"} className="min-h-[92px]" /></Field>
            <div className="space-y-4">
              <Field label="Search radius" htmlFor="bf-r" hint={estimate.area ? `≈ ${Math.round(estimate.area).toLocaleString("en-US")} km² around each location's centre.` : "Searches the whole named area — a city, region, province or country."}>
                <Select id="bf-r" value={f.radius} onChange={set("radius")}>
                  {RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
                  <option value="0">Entire area (city / region / province / country)</option>
                </Select>
              </Field>
              <Field label="How many businesses" htmlFor="bf-t" hint="Stops here; press Continue later to find more."><Input id="bf-t" type="number" min={1} max={20000} value={f.target} onChange={set("target")} /></Field>
            </div>
          </div>
          <Field label="Business types" htmlFor="bf-q" required hint="Comma-separated — each type is searched in every zone. Tap the suggestions to add or remove.">
            <Input id="bf-q" value={f.queries} onChange={set("queries")} placeholder="plumbers, electricians, roofers" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR.map((c) => {
              const on = chosen.some((x) => x.toLowerCase() === c.toLowerCase());
              return <button key={c} type="button" onClick={() => toggleCat(c)} className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:bg-subtle"}`}>{c}</button>;
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox checked={f.findEmails} onChange={tick("findEmails")} label="Find public business emails automatically" />
            <Checkbox checked={f.autoAudit} onChange={tick("autoAudit")} label="Analyse their websites automatically" />
            <Checkbox checked={f.smallOnly} onChange={tick("smallOnly")} label="Small local businesses only (skip chains and landmarks)" />
            <Checkbox checked={f.hasPhone} onChange={tick("hasPhone")} label="Must have a phone number" />
          </div>
          <button type="button" className="text-sm font-medium text-accent" onClick={() => setMore((v) => !v)}>{more ? "Fewer options" : "More options (data sources, website, rating, campaign, limits)"}</button>
          {more && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Website" htmlFor="bf-w"><Select id="bf-w" value={f.website} onChange={set("website")}><option value="any">Any</option><option value="has">Has a website</option><option value="none">No website (best prospects)</option></Select></Field>
              <Field label="Minimum Google rating" htmlFor="bf-mr"><Input id="bf-mr" type="number" min={0} max={5} step="0.5" value={f.minRating} onChange={set("minRating")} /></Field>
              <Field label="Add to campaign" htmlFor="bf-c"><Select id="bf-c" value={f.campaignId} onChange={set("campaignId")}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              <Field label="Maximum search requests" htmlFor="bf-mx" hint={f.google ? `Google ≈ $0.035 each → up to ≈ $${estimate.dollars.toFixed(2)} (estimate).` : "OpenStreetMap is free."}><Input id="bf-mx" type="number" min={1} max={50000} value={f.maxRequests} onChange={set("maxRequests")} /></Field>
              <Field label="Zone size" htmlFor="bf-z"><Select id="bf-z" value={f.coverage} onChange={set("coverage")}><option value="auto">Automatic (recommended)</option><option value="regional">50 km zones</option><option value="provincial">100 km zones</option><option value="national">200 km zones</option><option value="local">One search per location</option></Select></Field>
              <div className="flex flex-col gap-1.5 pt-6">
                <Checkbox checked={f.google} onChange={tick("google")} disabled={!googleConfigured} label="Google Places" />
                <Checkbox checked={f.osm} onChange={tick("osm")} label="OpenStreetMap (free)" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-3">
                <Checkbox checked={f.includeExisting} onChange={tick("includeExisting")} label="Include businesses already in my leads (adds them to the campaign)" />
                <Checkbox checked={f.repeatSearches} onChange={tick("repeatSearches")} label="Search again in areas searched in the last 30 days" />
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="submit" loading={busy === "start"} loadingText="Starting…" disabled={!canRun || (!f.google && !f.osm)} className="h-11 px-6 text-base"><Search className="h-5 w-5" /> Find businesses</Button>
            <span className="text-xs text-muted">Runs in the background; pause, resume or continue it below. OpenStreetMap data © OpenStreetMap contributors.</span>
          </div>
        </form>
      </Card>

      {runs.length > 0 && (
        <Card>
          <CardHeader title="Your searches" description="Live progress — finished zones are remembered, so Continue only searches what's new." />
          <ul className="divide-y divide-border">
            {runs.map((r) => {
              const radius = (r.options as any)?.radiusKm;
              return (
                <li key={r.id} className="space-y-1.5 px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.queries.join(", ")}</span><span className="text-muted">{radius ? `within ${radius} km of` : "in"} {r.locations.join("; ")}</span><Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                    <span className="ml-auto flex gap-1.5">
                      {["QUEUED", "RUNNING"].includes(r.status) && <Button size="sm" variant="outline" loading={busy === `${r.id}:pause`} onClick={() => control(r.id, "pause")}><Pause className="h-3.5 w-3.5" /> Pause</Button>}
                      {r.status === "PAUSED" && <Button size="sm" loading={busy === `${r.id}:resume`} onClick={() => control(r.id, "resume")}><Play className="h-3.5 w-3.5" /> Resume</Button>}
                      {r.zones.failed > 0 && <Button size="sm" variant="outline" onClick={() => control(r.id, "retry_failed")}><RotateCcw className="h-3.5 w-3.5" /> Retry failed zones</Button>}
                      {["COMPLETED", "PAUSED", "CANCELLED"].includes(r.status) && <Button size="sm" variant="outline" loading={busy === `${r.id}:continue`} onClick={() => control(r.id, "continue", { addTarget: r.target, addRequests: r.maxRequests })}><Plus className="h-3.5 w-3.5" /> Continue — find more</Button>}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-accent/80 transition-all" style={{ width: `${Math.min(100, Math.round((r.found / Math.max(1, r.target)) * 100))}%` }} /></div>
                  <div className="text-xs text-muted">{r.found} of {r.target} found ({r.created} new, {r.duplicates} already known, {r.filtered} filtered out) · zones {r.zones.done}/{r.zones.total}{r.zones.failed ? ` · ${r.zones.failed} failed` : ""} · {r.requests}/{r.maxRequests} requests</div>
                  {r.message && <div className="text-xs text-faint">{r.message}</div>}
                  <Link href={r.campaignId ? `/leads?campaignId=${r.campaignId}` : "/leads?sort=newest"} className="text-xs font-medium text-accent hover:underline">View results →</Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
