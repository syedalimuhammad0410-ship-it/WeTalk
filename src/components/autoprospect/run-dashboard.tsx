"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Pause, Play, RotateCcw, Square, Plus, Send } from "lucide-react";
import { Alert, Badge, Card, CardHeader, ScoreBadge } from "../ui/misc";
import { Button, ButtonLink } from "../ui/button";
import { Field, Input } from "../ui/form";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";
import { RelTime } from "@/components/ui/time";

const TONE: Record<string, any> = { QUEUED: "blue", RUNNING: "blue", PAUSED: "amber", COMPLETED: "green", CANCELLED: "zinc", FAILED: "red" };
const ELIG: Record<string, [string, any]> = { ELIGIBLE: ["Eligible", "green"], NEEDS_REVIEW: ["Needs review", "amber"], INELIGIBLE: ["Not eligible", "red"], NO_EMAIL: ["No email", "zinc"] };

/** Live AutoProspect progress: every counter comes from the database, refreshed every few seconds. */
export function RunDashboard({ initial, canControl }: { initial: any; canControl: boolean }) {
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [cont, setCont] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [more, setMore] = useState({ target: "200", requests: "200" });
  const run = d.run;
  const c = d.counters;
  const live = ["QUEUED", "RUNNING"].includes(run.status);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => apiFetch(`/api/autoprospect/${run.id}`, { method: "GET" }).then(setD).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [live, run.id]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      await apiFetch(`/api/autoprospect/${run.id}`, { method: "PATCH", body: { action, ...extra } });
      kickJobs();
      setD(await apiFetch(`/api/autoprospect/${run.id}`, { method: "GET" }));
      toast.success({ pause: "Paused — nothing finished is lost", resume: "Resumed", cancel: "Cancelled — results are kept", retry_failed: "Retrying failed steps", continue: "Continuing discovery" }[action] ?? "Done");
      return true;
    } catch (e) {
      toast.error("Action failed", (e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const stages: [string, number, string?][] = [
    ["Businesses discovered", c.discovered],
    ["Duplicates removed", c.duplicates],
    ["Websites identified", c.websitesIdentified],
    ["Emails discovered", c.emailsDiscovered],
    ["Emails validated", c.emailsValidated],
    ["Websites analysed", c.websitesAnalyzed],
    ["Prompts generated", c.promptsGenerated],
    ["Outreach drafts created", c.draftsCreated],
    ["Eligible for outreach", c.eligible],
    ["Needs consent review", c.needsReview],
    ["Awaiting approval", c.awaitingApproval],
    ["Emails sent", c.sent],
  ];
  const zones = d.zones;
  const pct = c.discovered ? Math.round((c.processed / Math.max(1, c.processed + c.pending)) * 100) : 0;

  return (
    <div className="space-y-5">
      <Link href="/autoprospect" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> AutoProspect</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{run.name}</h1><Badge tone={TONE[run.status]}>{run.status.toLowerCase()}</Badge></div>
          <p className="mt-1 text-sm text-muted">{run.message}</p>
          {d.discovery && <p className="mt-1 text-xs text-faint">{d.discovery.queries.join(", ")} · {d.discovery.locations.join("; ")} · target {d.discovery.target} · providers: {d.discovery.providers.map((p: string) => (p === "google_places" ? "Google Places" : "OpenStreetMap")).join(", ")}</p>}
        </div>
        {canControl && (
          <div className="flex flex-wrap gap-2">
            {live && <Button variant="outline" loading={busy === "pause"} onClick={() => act("pause")}><Pause className="h-4 w-4" /> Pause</Button>}
            {run.status === "PAUSED" && <Button loading={busy === "resume"} onClick={() => act("resume")}><Play className="h-4 w-4" /> Resume</Button>}
            {(c.failed > 0 || zones?.failed > 0) && <Button variant="outline" loading={busy === "retry_failed"} onClick={() => act("retry_failed")}><RotateCcw className="h-4 w-4" /> Restart failed tasks</Button>}
            {!live && <Button variant="outline" onClick={() => setCont(true)}><Plus className="h-4 w-4" /> Continue discovery</Button>}
            {run.campaignId && <ButtonLink variant="outline" href={`/leads?campaignId=${run.campaignId}`}><Download className="h-4 w-4" /> View & export results</ButtonLink>}
            {run.campaignId && <ButtonLink variant="outline" href={`/outreach?campaignId=${run.campaignId}`}><Send className="h-4 w-4" /> Outreach queue</ButtonLink>}
            {(live || run.status === "PAUSED") && <Button variant="ghost" onClick={() => setCancel(true)}><Square className="h-4 w-4" /> Cancel</Button>}
          </div>
        )}
      </div>

      <Card className="p-5">
        <div className="mb-2 flex justify-between text-sm"><span className="font-medium">{run.phase === "DISCOVERY" ? "Discovering and researching" : run.phase === "PROCESSING" ? "Researching businesses" : "Finished"}</span><span className="tabular-nums text-muted">{c.processed} of {c.processed + c.pending} businesses processed</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, pct)}%` }} /></div>
        {zones && <p className="mt-2 text-xs text-muted">Search zones: {zones.done} done · {zones.pending} remaining{zones.split ? ` · ${zones.split} split into smaller zones` : ""}{zones.failed ? ` · ${zones.failed} failed` : ""} · {c.requests} provider requests (≈ ${(c.costCents / 100).toFixed(2)})</p>}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stages.map(([label, n]) => (
          <Card key={label} className="p-4"><div className="text-2xl font-semibold tabular-nums">{(n ?? 0).toLocaleString("en-US")}</div><div className="text-[13px] text-muted">{label}</div></Card>
        ))}
      </div>
      <p className="text-xs text-muted">{c.skipped} skipped by your filters · {c.failed} failed · {c.aiEmails} AI-written emails · Every number is read live from the database.</p>

      {(d.failed.length > 0 || d.zoneErrors.length > 0) && (
        <Card>
          <CardHeader title="Errors" description="Failed businesses are retried up to 3 times; use Restart failed tasks to try again." />
          <ul className="divide-y divide-border text-sm">
            {d.zoneErrors.map((z: any) => <li key={z.id} className="px-5 py-2.5"><span className="font-medium">Zone {z.label}</span> · “{z.query}” — <span className="text-danger">{z.error}</span></li>)}
            {d.failed.map((i: any) => <li key={i.id} className="px-5 py-2.5"><Link href={`/leads/${i.businessId}`} className="font-medium hover:text-accent">{i.business?.name ?? "Lead"}</Link> — <span className="text-danger">{i.error}</span></li>)}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Latest businesses" description="Most recently processed first." />
        {d.recent.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{live ? "Searching… businesses appear here as they are found." : "No businesses yet."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="px-5 py-2 font-medium">Business</th><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">Eligibility</th><th className="px-3 py-2 font-medium">Opportunity</th><th className="px-3 py-2 font-medium">Step</th><th className="px-3 py-2 font-medium">Updated</th></tr></thead>
              <tbody className="divide-y divide-border">
                {d.recent.map((i: any) => (
                  <tr key={i.id}>
                    <td className="px-5 py-2"><Link href={`/leads/${i.businessId}`} className="font-medium hover:text-accent">{i.business?.name ?? "—"}</Link><div className="text-xs text-muted">{i.business?.city ?? ""}</div></td>
                    <td className="px-3 py-2 text-xs">{i.business?.email ?? <span className="text-faint">none found</span>}</td>
                    <td className="px-3 py-2">{i.eligibility ? <Badge tone={ELIG[i.eligibility]?.[1] ?? "zinc"}>{ELIG[i.eligibility]?.[0] ?? i.eligibility}</Badge> : <span className="text-xs text-faint">—</span>}</td>
                    <td className="px-3 py-2"><ScoreBadge score={i.business?.opportunityScore ?? null} /></td>
                    <td className="px-3 py-2 text-xs text-muted">{i.status === "DONE" ? (i.draftAt ? "Draft ready" : i.skipReason ?? "Researched") : i.status === "SKIPPED" ? `Skipped: ${i.skipReason}` : i.status === "FAILED" ? "Failed" : i.contactsAt || i.auditAt ? "Researching…" : "Queued"}</td>
                    <td className="px-3 py-2 text-xs text-faint"><RelTime d={i.updatedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {run.status === "COMPLETED" && c.awaitingApproval > 0 && <Alert tone="success" title={`${c.awaitingApproval} personalised drafts are waiting for your approval`} action={<ButtonLink size="sm" href={`/outreach?campaignId=${run.campaignId}`}>Review outreach</ButtonLink>} />}

      <Dialog open={cont} onClose={() => setCont(false)} title="Continue discovery" description="Finished zones, categories and keywords are remembered — only new or unfinished searches run." footer={<><Button variant="outline" onClick={() => setCont(false)}>Cancel</Button><Button loading={busy === "continue"} onClick={async () => { if (await act("continue", { addTarget: +more.target, addRequests: +more.requests })) setCont(false); }}>Continue</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Find this many more businesses" htmlFor="ct"><Input id="ct" type="number" min={0} value={more.target} onChange={(e) => setMore((s) => ({ ...s, target: e.target.value }))} /></Field>
          <Field label="Allow this many more requests" htmlFor="cr"><Input id="cr" type="number" min={0} value={more.requests} onChange={(e) => setMore((s) => ({ ...s, requests: e.target.value }))} /></Field>
        </div>
      </Dialog>
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} title="Cancel this run?" confirmLabel="Cancel run" loading={busy === "cancel"} onConfirm={async () => { if (await act("cancel")) setCancel(false); }} description="Everything already found, analysed and drafted is kept. Unfinished businesses are not processed." />
    </div>
  );
}
