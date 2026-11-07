"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardHeader, Alert } from "../ui/misc";
import { Button } from "../ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

type Provider = { id: "google_places" | "openstreetmap"; label: string; connected: boolean; enabled: boolean; reason: string | null; costPerRequestCents: number; remainingToday: number };
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** The one-click AutoProspect setup: configure a campaign, press the green button. */
export function AutoProspectForm({ templates, providers, paused, outreachMode, canStart }: { templates: { id: string; name: string }[]; providers: Provider[]; paused: boolean; outreachMode: string; canStart: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: "", locations: "", categories: "", keywords: "", coverage: "auto", target: "200", maxRequests: "300", budget: "",
    website: "any", hasPhone: false, requireEmail: false, minRating: "0", minOpportunity: "0", minWebsiteScore: "0", maxWebsiteScore: "100",
    smallOnly: true, includeExisting: false, repeatSearches: false, excludeNames: "", excludeDomains: "",
    contacts: true, audit: true, prompts: true, drafts: true, maxAiEmails: "50", concurrency: "2", templateId: "",
    google: providers.find((p) => p.id === "google_places")?.connected ?? false, osm: !(providers.find((p) => p.id === "google_places")?.connected ?? false),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const tick = (k: keyof typeof f) => (v: boolean) => setF((s) => ({ ...s, [k]: v }));
  const google = providers.find((p) => p.id === "google_places");
  const estimate = useMemo(() => {
    const req = Math.max(1, Number(f.maxRequests) || 0);
    const budgetReq = f.budget && f.google ? Math.floor((Number(f.budget) * 100) / (google?.costPerRequestCents ?? 3.5)) : Infinity;
    const used = Math.min(req, budgetReq);
    return { requests: used, dollars: f.google ? (used * (google?.costPerRequestCents ?? 3.5)) / 100 : 0 };
  }, [f.maxRequests, f.budget, f.google, google]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const providersSel = [f.google && "google_places", f.osm && "openstreetmap"].filter(Boolean);
      const r = await apiFetch<{ id: string }>("/api/autoprospect", {
        body: {
          name: f.name || `${list(f.categories)[0] ?? "Prospects"} — ${list(f.locations)[0] ?? ""}`.slice(0, 120),
          locations: f.locations.split(/\n|;/).map((x) => x.trim()).filter(Boolean), categories: list(f.categories), keywords: list(f.keywords), providers: providersSel,
          target: +f.target, maxRequests: +f.maxRequests, budgetCents: f.budget ? Math.round(Number(f.budget) * 100) : 0, coverage: f.coverage,
          website: f.website, hasPhone: f.hasPhone, requireEmail: f.requireEmail, minRating: +f.minRating, minOpportunity: +f.minOpportunity, minWebsiteScore: +f.minWebsiteScore, maxWebsiteScore: +f.maxWebsiteScore,
          smallOnly: f.smallOnly, includeExisting: f.includeExisting, repeatSearches: f.repeatSearches, excludeNames: list(f.excludeNames), excludeDomains: list(f.excludeDomains),
          steps: { contacts: f.contacts, audit: f.audit, prompts: f.prompts, drafts: f.drafts }, maxAiEmails: +f.maxAiEmails, concurrency: +f.concurrency, templateId: f.templateId || null,
        },
      });
      kickJobs();
      toast.success("AutoProspect started", "It keeps running in the background — you can close this page.");
      router.push(`/autoprospect/${r.id}`);
    } catch (err) {
      toast.error("Could not start", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 px-6 py-8 text-white sm:px-10">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">WebScout AI · Automation</div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">AUTOPROSPECT</h2>
          <p className="mt-2 max-w-2xl text-emerald-50">Discover businesses. Research them. Find public business emails. Prepare personalised outreach. Organise your pipeline.</p>
          <ol className="mt-5 grid gap-2 text-sm text-emerald-50 sm:grid-cols-3">
            {["Discover businesses across your regions", "Find publicly listed business emails", "Analyse websites & score opportunities", "Generate website prompts", "Write personalised outreach drafts", "Queue eligible contacts for approval"].map((s, i) => <li key={s} className="flex gap-2"><span className="font-semibold text-white">{i + 1}.</span>{s}</li>)}
          </ol>
          <button type="button" onClick={() => setOpen(true)} disabled={!canStart} className="mt-6 inline-flex h-14 items-center gap-3 rounded-xl bg-white px-7 text-lg font-bold text-emerald-700 shadow-lg transition hover:bg-emerald-50 disabled:opacity-60">
            <Rocket className="h-6 w-6" /> START AUTOMATED PROSPECTING
          </button>
          {!canStart && <p className="mt-2 text-sm text-emerald-100">Your role cannot start automated prospecting.</p>}
        </div>
      </Card>

      {paused && <Alert tone="warning" title="All automation is paused">Resume it in Settings → Automation Control Center before starting a run.</Alert>}

      {open && (
        <Card>
          <CardHeader title="New automated prospecting campaign" description={`Sending mode: ${outreachMode === "AUTOMATED_ELIGIBLE" ? "automated for eligible contacts" : outreachMode === "MANUAL" ? "manual (drafts only)" : "approval required"} — drafts never go out without passing compliance checks.`} />
          <form onSubmit={start} className="space-y-6 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Campaign name" htmlFor="ap-n" required className="sm:col-span-2"><Input id="ap-n" value={f.name} onChange={set("name")} placeholder="Ontario commercial cleaning — November" /></Field>
              <Field label="Locations" htmlFor="ap-l" required hint="One per line: city, region, province/state or country. e.g. “Ontario, Canada” or “Toronto, ON”."><Textarea id="ap-l" value={f.locations} onChange={set("locations")} placeholder={"Ontario, Canada\nGreater Toronto Area"} className="min-h-[92px]" /></Field>
              <div className="space-y-4">
                <Field label="Business categories" htmlFor="ap-c" required hint="Comma-separated."><Input id="ap-c" value={f.categories} onChange={set("categories")} placeholder="commercial cleaning, office cleaning" /></Field>
                <Field label="Extra search keywords" htmlFor="ap-k" hint="Optional variations searched as well."><Input id="ap-k" value={f.keywords} onChange={set("keywords")} placeholder="janitorial services" /></Field>
              </div>
              <Field label="Geographic coverage" htmlFor="ap-cov" hint="Large areas are split into overlapping zones; busy zones are split further automatically."><Select id="ap-cov" value={f.coverage} onChange={set("coverage")}><option value="auto">Automatic (recommended)</option><option value="local">Local — one search per location</option><option value="regional">Regional — 50 km zones</option><option value="provincial">Provincial — 100 km zones</option><option value="national">National — 200 km zones</option></Select></Field>
              <Field label="Data providers"><div className="flex flex-col gap-1.5 pt-1">
                <Checkbox checked={f.google} onChange={tick("google")} label={`Google Places${google?.connected ? "" : " (not connected)"}`} disabled={!google?.connected} />
                <Checkbox checked={f.osm} onChange={tick("osm")} label="OpenStreetMap (free, © OpenStreetMap contributors)" />
              </div></Field>
              <Field label="Target businesses" htmlFor="ap-t" hint="Discovery stops here; Continue adds more later."><Input id="ap-t" type="number" min={1} max={20000} value={f.target} onChange={set("target")} /></Field>
              <Field label="Maximum search requests" htmlFor="ap-r" hint={`Processing cap. Google: about 20 results per request.${google ? ` ${google.remainingToday} left today.` : ""}`}><Input id="ap-r" type="number" min={1} max={50000} value={f.maxRequests} onChange={set("maxRequests")} /></Field>
              <Field label="Budget limit (USD, optional)" htmlFor="ap-b" hint="Stops discovery before Google charges exceed this."><Input id="ap-b" type="number" min={0} step="1" value={f.budget} onChange={set("budget")} placeholder="e.g. 10" /></Field>
              <div className="rounded-lg border border-border bg-subtle/40 p-3 text-sm">
                <div className="font-medium">Estimated discovery cost</div>
                <div className="mt-1 text-muted">Up to {estimate.requests.toLocaleString("en-US")} requests ≈ <strong className="text-fg">${estimate.dollars.toFixed(2)}</strong>{f.google ? " in Google Places charges (estimate; check your Google Cloud billing and free monthly allowance)." : " — OpenStreetMap is free."}</div>
              </div>
            </div>

            <button type="button" className="flex items-center gap-1 text-sm font-medium text-accent" onClick={() => setAdv((v) => !v)}>
              {adv ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} Filters, exclusions and steps
            </button>
            {adv && (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Website" htmlFor="ap-w"><Select id="ap-w" value={f.website} onChange={set("website")}><option value="any">Any</option><option value="has">Has a website</option><option value="none">No website</option></Select></Field>
                  <Field label="Minimum Google rating" htmlFor="ap-mr"><Input id="ap-mr" type="number" min={0} max={5} step="0.5" value={f.minRating} onChange={set("minRating")} /></Field>
                  <Field label="Minimum opportunity score" htmlFor="ap-mo" hint="Drafts only for leads at or above this."><Input id="ap-mo" type="number" min={0} max={100} value={f.minOpportunity} onChange={set("minOpportunity")} /></Field>
                  <Field label="Website score from" htmlFor="ap-ws1"><Input id="ap-ws1" type="number" min={0} max={100} value={f.minWebsiteScore} onChange={set("minWebsiteScore")} /></Field>
                  <Field label="Website score to" htmlFor="ap-ws2"><Input id="ap-ws2" type="number" min={0} max={100} value={f.maxWebsiteScore} onChange={set("maxWebsiteScore")} /></Field>
                  <Field label="Parallel businesses" htmlFor="ap-cc" hint="1–5 researched at once."><Input id="ap-cc" type="number" min={1} max={5} value={f.concurrency} onChange={set("concurrency")} /></Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Checkbox checked={f.hasPhone} onChange={tick("hasPhone")} label="Has a phone number" />
                  <Checkbox checked={f.requireEmail} onChange={tick("requireEmail")} label="Has a public business email (others are kept but not drafted)" />
                  <Checkbox checked={f.smallOnly} onChange={tick("smallOnly")} label="Small local businesses only (skip chains, landmarks, attractions)" />
                  <Checkbox checked={f.includeExisting} onChange={tick("includeExisting")} label="Include businesses already in my CRM" />
                  <Checkbox checked={f.repeatSearches} onChange={tick("repeatSearches")} label="Repeat areas searched in the last 30 days" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Exclude business names containing" htmlFor="ap-xn" hint="Comma-separated."><Input id="ap-xn" value={f.excludeNames} onChange={set("excludeNames")} placeholder="franchise, holdings" /></Field>
                  <Field label="Exclude website domains" htmlFor="ap-xd"><Input id="ap-xd" value={f.excludeDomains} onChange={set("excludeDomains")} placeholder="competitor.ca" /></Field>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Steps for each business</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Checkbox checked={f.contacts} onChange={tick("contacts")} label="Find publicly listed business emails" />
                    <Checkbox checked={f.audit} onChange={tick("audit")} label="Analyse websites and score opportunities" />
                    <Checkbox checked={f.prompts} onChange={tick("prompts")} label="Generate detailed website prompts" />
                    <Checkbox checked={f.drafts} onChange={tick("drafts")} label="Write personalised outreach drafts" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="AI-written emails (max)" htmlFor="ap-ai" hint="Beyond this, drafts use your template + verified observations (saves AI quota)."><Input id="ap-ai" type="number" min={0} max={20000} value={f.maxAiEmails} onChange={set("maxAiEmails")} /></Field>
                  <Field label="Email template" htmlFor="ap-tpl"><Select id="ap-tpl" value={f.templateId} onChange={set("templateId")}><option value="">Default outreach template</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button type="submit" loading={busy} loadingText="Starting…" disabled={paused || (!f.google && !f.osm)} className="h-11 bg-emerald-600 px-6 text-base hover:bg-emerald-700"><Rocket className="h-5 w-5" /> Start automated prospecting</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <span className="text-xs text-muted">Runs in the background — close the browser any time. Pause, resume or cancel from the run page.</span>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
