"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Compass, KeyRound, Loader2, XCircle, Ban } from "lucide-react";
import { Card, CardHeader, Progress, Alert, Badge } from "../ui/misc";
import { Button, ButtonLink } from "../ui/button";
import { Field, Input, Select, Checkbox } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

import { kickJobs } from "../shell/job-tray";
import { RelTime } from "@/components/ui/time";

type Job = { id: string; label: string; status: string; progress: number; message: string | null; error: string | null; createdAt: string; result?: any; processed?: number; total?: number };

export function DiscoverForm({ configured, canRun, campaigns, recent, defaultCampaignId }: { configured: boolean; canRun: boolean; campaigns: { id: string; name: string }[]; recent: Job[]; defaultCampaignId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ location: "", category: "", searchTerms: "", radiusKm: "0", limit: "60", minRating: "0", maxRating: "5", website: "any", openStatus: "operational", autoAudit: true, campaignId: defaultCampaignId });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (!job || ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return;
    const t = setInterval(async () => {
      try {
        const j = await apiFetch<Job>(`/api/jobs/${job.id}`);
        setJob(j);
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(j.status)) {
          if (j.status === "COMPLETED") toast.success("Discovery finished", j.result?.message);
          if (j.status === "FAILED") toast.error("Discovery stopped", j.error ?? undefined);
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 1200);
    return () => clearInterval(t);
  }, [job, router, toast]);

  function validate() {
    const e: Record<string, string> = {};
    if (f.location.trim().length < 2) e.location = "Enter a city, region or address.";
    if (!f.category.trim() && !f.searchTerms.trim()) e.category = "Enter a category or search terms.";
    if (+f.limit < 1 || +f.limit > 300) e.limit = "Between 1 and 300.";
    if (+f.minRating > +f.maxRating) e.minRating = "Minimum must be ≤ maximum.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ jobId: string }>("/api/discovery", { body: { ...f, radiusKm: +f.radiusKm, limit: +f.limit, minRating: +f.minRating, maxRating: +f.maxRating, campaignId: f.campaignId || null } });
      setJob({ id: r.jobId, label: "", status: "QUEUED", progress: 0, message: "Queued…", error: null, createdAt: new Date().toISOString() });
      kickJobs();
    } catch (err) {
      toast.error("Search not started", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const running = job && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        {!configured && (
          <Alert tone="warning" title="Connect Google Places to discover businesses" action={<ButtonLink href="/settings/integrations" size="sm"><KeyRound className="h-4 w-4" /> Connect</ButtonLink>}>
            You can still <Link href="/leads?add=1" className="text-accent hover:underline">add businesses manually</Link> or import a CSV.
          </Alert>
        )}
        <Card>
          <form onSubmit={submit} noValidate>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Location" htmlFor="loc" required error={errors.location} className="sm:col-span-2"><Input id="loc" value={f.location} onChange={set("location")} placeholder="Mississauga, Ontario" invalid={Boolean(errors.location)} /></Field>
              <Field label="Business category" htmlFor="cat" error={errors.category} hint="e.g. Restaurants, Plumbers, Dentists"><Input id="cat" value={f.category} onChange={set("category")} placeholder="Restaurants" invalid={Boolean(errors.category)} /></Field>
              <Field label="Search terms" htmlFor="terms" hint="Comma-separated; each runs as its own query (≤ 60 results each)."><Input id="terms" value={f.searchTerms} onChange={set("searchTerms")} placeholder="italian, sushi, brunch" /></Field>
              <Field label="Radius (km)" htmlFor="rad" hint="0 = let Google decide from the location."><Input id="rad" type="number" min={0} max={50} value={f.radiusKm} onChange={set("radiusKm")} /></Field>
              <Field label="Number of businesses" htmlFor="lim" error={errors.limit}><Input id="lim" type="number" min={1} max={300} value={f.limit} onChange={set("limit")} /></Field>
              <Field label="Minimum rating" htmlFor="minr" error={errors.minRating}><Select id="minr" value={f.minRating} onChange={set("minRating")}>{["0", "3", "3.5", "4", "4.5"].map((v) => <option key={v} value={v}>{v === "0" ? "Any" : `${v}+`}</option>)}</Select></Field>
              <Field label="Maximum rating" htmlFor="maxr"><Select id="maxr" value={f.maxRating} onChange={set("maxRating")}>{["5", "4.5", "4", "3.5"].map((v) => <option key={v} value={v}>{v === "5" ? "Any" : `≤ ${v}`}</option>)}</Select></Field>
              <Field label="Website" htmlFor="web"><Select id="web" value={f.website} onChange={set("website")}><option value="any">Any</option><option value="has">Has website</option><option value="none">No website</option></Select></Field>
              <Field label="Open / closed" htmlFor="open"><Select id="open" value={f.openStatus} onChange={set("openStatus")}><option value="operational">Operational only</option><option value="any">Include closed</option></Select></Field>
              {campaigns.length > 0 && <Field label="Add to campaign" htmlFor="camp" className="sm:col-span-2"><Select id="camp" value={f.campaignId} onChange={set("campaignId")}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
              <div className="sm:col-span-2"><Checkbox checked={f.autoAudit} onChange={(v) => setF((s) => ({ ...s, autoAudit: v }))} label="Analyze websites automatically after discovery (enables opportunity filters)" /></div>
            </div>
            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted">Duplicates are detected by place ID, domain, phone and address — existing leads are never duplicated.</p>
              <Button type="submit" size="lg" loading={busy} disabled={!configured || !canRun || Boolean(running)}><Compass className="h-4 w-4" /> Find Businesses</Button>
            </div>
          </form>
        </Card>
        {job && (
          <Card className="p-5" aria-live="polite">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                {running ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : job.status === "COMPLETED" ? <CheckCircle2 className="h-4 w-4 text-success" /> : job.status === "CANCELLED" ? <Ban className="h-4 w-4 text-muted" /> : <XCircle className="h-4 w-4 text-danger" />}
                {running ? "Finding businesses…" : job.status === "COMPLETED" ? "Discovery complete" : job.status === "CANCELLED" ? "Cancelled" : "Discovery stopped"}
              </span>
              <span className="tabular-nums text-muted">{job.progress}%</span>
            </div>
            <Progress value={job.progress} label="Discovery progress" />
            <p className="mt-2 text-sm text-muted">{job.status === "FAILED" ? job.error : job.result?.message ?? job.message}</p>
            <div className="mt-4 flex gap-2">
              {running && <Button size="sm" variant="outline" onClick={() => apiFetch(`/api/jobs/${job.id}/cancel`, { body: {} }).then(() => toast.info("Cancelling…"))}>Cancel</Button>}
              {job.status === "COMPLETED" && <ButtonLink size="sm" href="/leads?sort=newest">View businesses</ButtonLink>}
              {job.status === "COMPLETED" && f.autoAudit && (job.result?.created ?? 0) > 0 && <span className="self-center text-xs text-muted">Website analysis continues in the background.</span>}
            </div>
          </Card>
        )}
      </div>
      <Card className="h-fit">
        <CardHeader title="Recent searches" />
        <ul className="divide-y divide-border">
          {recent.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">No searches yet.</li>}
          {recent.map((r) => (
            <li key={r.id} className="px-5 py-3 text-sm">
              <div className="flex items-start justify-between gap-2"><span className="font-medium">{r.label}</span><Badge tone={r.status === "COMPLETED" ? "green" : r.status === "FAILED" ? "red" : r.status === "CANCELLED" ? "zinc" : "blue"}>{r.status.toLowerCase()}</Badge></div>
              <p className="mt-0.5 text-xs text-muted">{r.status === "FAILED" ? r.error : r.result?.message ?? r.message} · <RelTime d={r.createdAt} /></p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
