"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle, Square } from "lucide-react";
import { Alert, Badge, Card, CardHeader } from "../ui/misc";
import { Button } from "../ui/button";
import { Field, Input, Select, Switch } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { RelTime } from "@/components/ui/time";

const can = (d: any, p: string) => (d.permissions as string[]).includes(p);

function useSave() {
  const router = useRouter();
  const toast = useToast();
  return async (url: string, body: unknown, ok: string, method = "PATCH") => {
    try {
      await apiFetch(url, { method, body });
      toast.success(ok);
      router.refresh();
      return true;
    } catch (e) {
      toast.error("Not saved", (e as Error).message);
      return false;
    }
  };
}

const SWITCHES: [string, string, string][] = [
  ["discoveryEnabled", "Business discovery", "Finding businesses with your configured providers (AutoProspect and large-area search)."],
  ["geoExpansionEnabled", "Geographic expansion", "Split large areas (regions, provinces, countries) into overlapping zones. Off: one search per location."],
  ["contactDiscoveryEnabled", "Contact discovery", "Check each business's own public pages for listed business emails (robots.txt respected, nothing guessed)."],
  ["websiteAnalysisEnabled", "Website analysis", "Audit each website automatically."],
  ["opportunityScoringEnabled", "Opportunity scoring", "Use opportunity scores to qualify businesses before drafting outreach."],
  ["promptGenerationEnabled", "Prompt generation", "Generate a detailed website-development prompt for each qualified business."],
  ["emailGenerationEnabled", "Email generation", "Write a personalised outreach draft for each qualified business."],
  ["eligibilityChecksEnabled", "Email eligibility checks", "CASL checks: consent basis, no-solicitation notices, role relevance, suppression. Off: every address needs manual review."],
  ["outreachSendingEnabled", "Outreach sending", "Allow automated sending in “Automated eligible outreach” mode. Human-approved sends are unaffected."],
  ["inboxMonitoringEnabled", "Inbox monitoring", "Check connected Gmail inboxes for replies every few minutes."],
  ["aiResponseDrafting", "AI reply generation", "Draft replies to incoming emails for approval."],
  ["followUpSchedulingEnabled", "Follow-up scheduling", "Schedule and process follow-ups after outreach."],
];

export function AutomationCenter({ d }: { d: any }) {
  const a = d.settings.automation;
  const save = useSave();
  const [v, setV] = useState<Record<string, any>>(Object.fromEntries([...SWITCHES.map(([k]) => [k, a[k]]), ["outreachMode", a.outreachMode], ["autoSendImpliedConsent", a.autoSendImpliedConsent]]));
  const manage = can(d, "automation.manage");
  const compliance = can(d, "compliance.manage");
  const toggle = async (k: string, x: any) => {
    const prev = v[k];
    setV((s) => ({ ...s, [k]: x }));
    if (!(await save("/api/settings/automation", { [k]: x }, typeof x === "boolean" ? `${x ? "Enabled" : "Disabled"}` : "Saved"))) setV((s) => ({ ...s, [k]: prev }));
  };
  const active = (d.runs ?? []).filter((r: any) => ["QUEUED", "RUNNING", "PAUSED"].includes(r.status));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Automation Control Center" description="Complete control over what happens automatically. Every change is saved and logged." />
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          {a.automationPaused ? (
            <><Badge tone="amber">All automation paused</Badge><Button disabled={!manage} onClick={() => save("/api/settings/automation/pause-all", { paused: false }, "All automation resumed", "POST")}><PlayCircle className="h-4 w-4" /> Resume all automation</Button></>
          ) : (
            <><Badge tone="green">Automation running</Badge><Button variant="outline" disabled={!manage} onClick={() => save("/api/settings/automation/pause-all", { paused: true }, "All automation paused", "POST")}><PauseCircle className="h-4 w-4" /> Pause all automation</Button></>
          )}
          <span className="text-xs text-muted">Pausing stops AutoProspect runs, large-area discovery, inbox checks, follow-ups and automatic replies. Nothing finished is lost.</span>
        </div>
        <div className="divide-y divide-border px-5">
          {SWITCHES.map(([k, l, desc]) => <Switch key={k} label={l} description={desc} checked={Boolean(v[k])} disabled={!manage || (k === "eligibilityChecksEnabled" && !compliance)} onChange={(x) => toggle(k, x)} />)}
        </div>
      </Card>

      <Card>
        <CardHeader title="Outreach sending mode" description="How generated outreach is sent." />
        <div className="space-y-4 p-5">
          <Field label="Mode" htmlFor="om">
            <Select id="om" value={v.outreachMode} disabled={!manage} onChange={(e) => toggle("outreachMode", e.target.value)}>
              <option value="MANUAL">1 — Manual: AI writes drafts; nothing is sent automatically</option>
              <option value="APPROVAL">2 — Approval required (default): you approve each email in Outreach</option>
              <option value="AUTOMATED_ELIGIBLE">3 — Automated eligible outreach: auto-send only with a documented, valid consent basis</option>
            </Select>
          </Field>
          {v.outreachMode === "AUTOMATED_ELIGIBLE" && (
            <Alert tone="warning" title="CASL requirements for automated sending">
              Automated sends only go to addresses with a recorded consent basis and evidence, never to suppressed or ineligible contacts, and only when your sender identification (Compliance → physical address) and unsubscribe footer are set. Express consent qualifies. Implied consent from conspicuous publication also needs the message to be relevant to the recipient&apos;s business role and no statement refusing unsolicited messages — a publicly visible address alone is not proof of consent.
            </Alert>
          )}
          <Switch label="Allow automated sending under implied consent (conspicuous publication)" description="Off by default: such contacts are queued for your approval instead. Only compliance managers can turn this on." checked={Boolean(v.autoSendImpliedConsent)} disabled={!compliance} onChange={(x) => toggle("autoSendImpliedConsent", x)} />
          {!d.settings.compliance.physicalAddress?.trim() && <p className="text-xs text-warning">Add your business mailing address in Compliance — automated sending stays off without it.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Active campaigns" description="Stop an automated prospecting run at any time; finished work is kept." />
        {active.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No active runs.</p> : (
          <ul className="divide-y divide-border">
            {active.map((r: any) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Link href={`/autoprospect/${r.id}`} className="min-w-0 flex-1 font-medium hover:text-accent">{r.name}</Link>
                <Badge tone={r.status === "PAUSED" ? "amber" : "blue"}>{r.status.toLowerCase()}</Badge>
                <Button size="sm" variant="outline" disabled={!can(d, "campaigns.manage")} onClick={() => save(`/api/autoprospect/${r.id}`, { action: "cancel" }, "Campaign stopped")}><Square className="h-4 w-4" /> Stop</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Automation history" />
        {(d.history ?? []).length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {d.history.map((h: any) => <li key={h.id} className="flex justify-between gap-3 px-5 py-2.5"><span>{h.summary}</span><span className="shrink-0 text-xs text-faint"><RelTime d={h.createdAt} /></span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ProvidersSettings({ d }: { d: any }) {
  const save = useSave();
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries((d.providers ?? []).map((p: any) => [p.id, String(p.dailyRequestLimit)])));
  const manage = can(d, "integrations.manage");
  return (
    <Card>
      <CardHeader title="Discovery providers" description="Each source has its own adapter; results from every provider are merged and de-duplicated (same website, phone + name, address, or name at the same location)." />
      <div className="divide-y divide-border">
        {(d.providers ?? []).map((p: any) => (
          <div key={p.id} className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.label}</span>
              <Badge tone={p.connected ? "green" : "zinc"}>{p.connected ? "Connected" : "Not connected"}</Badge>
              {!p.enabled && <Badge tone="amber">Disabled</Badge>}
            </div>
            <p className="text-sm text-muted">{p.description}{p.reason ? ` ${p.reason}` : ""}</p>
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-faint">Requests today</div><div className="tabular-nums">{p.today.requests} ({p.remainingToday} left)</div></div>
              <div><div className="text-xs text-faint">Results today</div><div className="tabular-nums">{p.today.results}</div></div>
              <div><div className="text-xs text-faint">Last 30 days</div><div className="tabular-nums">{p.last30.requests} requests · ≈ ${(p.last30.costCents / 100).toFixed(2)}</div></div>
              <div><div className="text-xs text-faint">Estimated cost</div><div>{p.costPerRequestCents ? `≈ $${(p.costPerRequestCents / 100).toFixed(3)} / request` : "Free"}</div></div>
              <div><div className="text-xs text-faint">Last successful request</div><div>{p.lastSuccessAt ? <RelTime d={p.lastSuccessAt} /> : "—"}</div></div>
              <div className="sm:col-span-3"><div className="text-xs text-faint">Last error</div><div className={p.lastError ? "text-danger" : ""}>{p.lastError ? <>{p.lastError} (<RelTime d={p.lastErrorAt} />)</> : "None"}</div></div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Switch label="Enabled" checked={p.enabled} disabled={!manage} onChange={(x) => save("/api/settings/providers", { provider: p.id, enabled: x }, x ? "Provider enabled" : "Provider disabled")} />
              <Field label="Daily request limit" htmlFor={`lim-${p.id}`}><Input id={`lim-${p.id}`} type="number" min={0} className="w-32" value={limits[p.id] ?? ""} disabled={!manage} onChange={(e) => setLimits((s) => ({ ...s, [p.id]: e.target.value }))} /></Field>
              <Button size="sm" variant="outline" disabled={!manage} onClick={() => save("/api/settings/providers", { provider: p.id, dailyRequestLimit: +(limits[p.id] ?? 0) }, "Limit saved")}>Save limit</Button>
            </div>
            {p.attribution && <p className="text-xs text-faint">{p.attribution}</p>}
          </div>
        ))}
        <div className="px-5 py-4 text-sm text-muted">
          <div className="font-medium text-fg">Your own data</div>
          Import business lists you are licensed to use from a CSV on the Leads page (Import). Licensed commercial directories can be added as further adapters. Websites are never scraped against their terms, and access restrictions are never bypassed.
        </div>
      </div>
    </Card>
  );
}
