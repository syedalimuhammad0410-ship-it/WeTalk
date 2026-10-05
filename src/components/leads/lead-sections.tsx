"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleHelp, Copy, ExternalLink, FileCode2, Gauge, Lightbulb, Minus, Plus, Sparkles, ChevronDown } from "lucide-react";
import { Card, CardHeader, EmptyState, ScoreBar, ScoreRing, Badge, Alert } from "../ui/misc";
import { Button, ButtonLink } from "../ui/button";
import { useToast } from "../ui/toast";
import { cn } from "@/lib/utils";
import { SCORE_CATEGORIES, SCORE_CATEGORY_LABEL, WEBSITE_CLASS_META, LEAD_STATUS_META, type LeadStatusT } from "@/lib/constants";
import type { LeadData, LeadPerms } from "./types";
import { RelTime, DateTimeText } from "@/components/ui/time";

function Fact({ label, value, source }: { label: string; value?: React.ReactNode; source?: string | null }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 text-sm sm:grid-cols-[140px_1fr]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{empty ? <span className="text-faint">Not found</span> : value}{source && !empty && <span className="ml-1.5 text-xs text-faint">· {source}</span>}</dd>
    </div>
  );
}

export function OverviewTab({ data, perms, onTab, onAudit, onPrompt, busy }: { data: LeadData; perms: LeadPerms; onTab: (t: any) => void; onAudit: () => void; onPrompt: () => void; busy: string | null }) {
  const b = data.business;
  const src = b.source === "GOOGLE_PLACES" ? "Google Places" : b.source === "MANUAL" ? "Manual entry" : b.source === "CSV_IMPORT" ? "CSV import" : "Demo data";
  const next = !data.audit
    ? { text: "Analyze the website to find opportunities.", cta: perms.audit ? <Button size="sm" onClick={onAudit} loading={busy === "audit"} loadingText="Analyzing…"><Gauge className="h-4 w-4" /> Analyze website</Button> : null }
    : !data.prompt
      ? { text: "Generate a detailed, business-specific website prompt.", cta: perms.prompt ? <Button size="sm" onClick={onPrompt} loading={busy === "prompt"} loadingText="Generating…"><FileCode2 className="h-4 w-4" /> Generate prompt</Button> : null }
      : !b.email
        ? { text: "No public email found. Add one from a legitimate source to start outreach.", cta: null }
        : !data.messages.some((m: any) => m.direction === "OUTBOUND")
          ? { text: "Write a personalised outreach email based on the audit.", cta: <Button size="sm" onClick={() => onTab("emails")}>Write outreach</Button> }
          : { text: "Track replies in the conversation.", cta: <Button size="sm" variant="outline" onClick={() => onTab("conversation")}>Open conversation</Button> };
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {data.listingStale != null && <Alert tone="warning" title={`Google listing data is ${data.listingStale} days old`}>Your workspace refreshes Places data after this period (Settings → Data). Re-run discovery for this area to refresh it.</Alert>}
        {!b.doNotContact && (
          <Alert tone="info" title="Next step" action={next.cta}>{next.text}</Alert>
        )}
        <Card>
          <CardHeader title="Business" description="Only information from the listed sources. Missing values are never invented." />
          <dl className="divide-y divide-border px-5">
            <Fact label="Name" value={b.name} source={src} />
            <Fact label="Category" value={b.category} source={src} />
            <Fact label="Business type" value={<>{data.playbook.label} <span className="text-xs text-faint">({b.businessTypeConfidence ?? "?"}% confidence{b.businessTypeConfidence === 100 ? ", set manually" : ""})</span></>} />
            <Fact label="Address" value={b.address} source={src} />
            <Fact label="Phone" value={b.phone && <a href={`tel:${b.phone}`} className="hover:text-accent">{b.phone}</a>} source={src} />
            <Fact label="Website" value={b.website && <a href={b.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-accent">{b.website}<ExternalLink className="h-3 w-3" /></a>} source={src} />
            <Fact label="Email" value={b.email} source={b.emailSource} />
            <Fact label="Hours" value={b.hours?.length ? <ul className="space-y-0.5">{b.hours.map((h: string) => <li key={h}>{h}</li>)}</ul> : null} source={src} />
            <Fact label="Rating" value={b.rating != null ? `${b.rating} from ${b.reviewCount ?? 0} reviews` : null} source={src} />
            <Fact label="Social" value={Object.keys(b.socialLinks ?? {}).length ? <span className="flex flex-wrap gap-2">{Object.entries(b.socialLinks).map(([k, v]) => <a key={k} href={v as string} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{k}</a>)}</span> : null} />
            <Fact label="Listing status" value={b.operationalStatus?.replace(/_/g, " ").toLowerCase()} source={src} />
            <Fact label="Campaigns" value={b.campaignLeads?.length ? b.campaignLeads.map((c: any) => <Link key={c.campaign.id} href={`/campaigns/${c.campaign.id}`} className="mr-2 text-accent hover:underline">{c.campaign.name}</Link>) : null} />
            <Fact label="Assigned to" value={b.assignedTo?.name} />
            <Fact label="Discovered" value=<DateTimeText d={b.discoveredAt} /> />
          </dl>
        </Card>
        {b.contacts?.length > 0 && (
          <Card>
            <CardHeader title="Contacts" />
            <ul className="divide-y divide-border">
              {b.contacts.map((c: any) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div><div className="font-medium">{c.name ?? c.email ?? c.phone}</div><div className="text-xs text-muted">{c.email} {c.role && `· ${c.role}`}</div></div>
                  <span className="text-xs text-faint">{c.source}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <div className="space-y-5">
        <Card className="p-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><ScoreRing value={b.websiteScore} size={68} label="Website score" /><div className="mt-1 text-xs text-muted">Website</div></div>
            <div><ScoreRing value={b.opportunityScore} size={68} label="Opportunity score" /><div className="mt-1 text-xs text-muted">Opportunity</div></div>
            <div><ScoreRing value={b.leadScore} size={68} label="Lead score" /><div className="mt-1 text-xs text-muted">Lead</div></div>
          </div>
          {b.websiteClass && <p className="mt-4 text-center text-xs text-muted">{WEBSITE_CLASS_META[b.websiteClass]?.description}</p>}
        </Card>
        <Card>
          <CardHeader title="Status history" />
          <ol className="relative space-y-4 px-5 py-4">
            {data.statusHistory.map((s: any) => (
              <li key={s.id} className="relative pl-5">
                <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden />
                <div className="text-sm"><span className="font-medium">{LEAD_STATUS_META[s.toStatus as LeadStatusT]?.label}</span>{s.fromStatus && <span className="text-muted"> from {LEAD_STATUS_META[s.fromStatus as LeadStatusT]?.label}</span>}</div>
                <div className="text-xs text-faint"><DateTimeText d={s.createdAt} />{s.reason && ` · ${s.reason}`}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

const SEV: Record<string, { tone: any; icon: any; label: string }> = {
  CRITICAL: { tone: "red", icon: AlertTriangle, label: "Critical" },
  HIGH: { tone: "orange", icon: AlertTriangle, label: "High" },
  MEDIUM: { tone: "amber", icon: AlertTriangle, label: "Medium" },
  LOW: { tone: "slate", icon: CircleHelp, label: "Low" },
  POSITIVE: { tone: "green", icon: CheckCircle2, label: "Works well" },
};
const KIND: Record<string, { tone: any; label: string; title: string }> = {
  VERIFIED: { tone: "blue", label: "Verified", title: "Directly observed on the website or listing" },
  INFERRED: { tone: "violet", label: "Inferred", title: "A reasoned opportunity, not a fact" },
  UNKNOWN: { tone: "zinc", label: "Unknown", title: "Could not be determined automatically" },
};

export function AuditTab({ data, perms, onAudit, busy }: { data: LeadData; perms: LeadPerms; onAudit: () => void; busy: boolean }) {
  const a = data.audit;
  const [open, setOpen] = useState<string | null>(null);
  const [showPositive, setShowPositive] = useState(false);
  if (!a) return <Card><EmptyState icon={<Gauge className="h-5 w-5" />} title="No audit yet" description={data.business.website ? "Analyze the public website: technical, design, content, conversion, mobile and local SEO." : "No website is listed. Running the check records this and calculates the opportunity."} action={perms.audit && <Button onClick={onAudit} loading={busy} loadingText="Analyzing website…">Analyze website</Button>} /></Card>;
  if (a.status === "RUNNING") return <Card><EmptyState icon={<Gauge className="h-5 w-5 animate-pulse" />} title="Analyzing website…" description="This usually takes 10–40 seconds." /></Card>;
  if (a.status === "FAILED") return <Alert tone="danger" title="The last audit failed" action={perms.audit && <Button size="sm" onClick={onAudit} loading={busy}>Retry</Button>}>{a.error}</Alert>;
  const scores = a.scores ?? {};
  const breakdown = a.scoreBreakdown ?? {};
  const ex = a.extracted ?? {};
  const findings = a.findings ?? [];
  const issues = findings.filter((f: any) => f.severity !== "POSITIVE");
  const positives = findings.filter((f: any) => f.severity === "POSITIVE");
  const meta = WEBSITE_CLASS_META[a.classification ?? ""];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card className="p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <ScoreRing value={a.overallScore} size={96} label="Overall website score" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">{meta && <Badge tone={meta.tone}>{meta.label}</Badge>}<span className="text-xs text-muted">Audited <RelTime d={a.completedAt} />{a.durationMs ? ` in ${(a.durationMs / 1000).toFixed(1)}s` : ""}</span></div>
              <p className="mt-2 text-sm text-muted">{a.summary}</p>
              {a.finalUrl && <a href={a.finalUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">{a.finalUrl}<ExternalLink className="h-3 w-3" /></a>}
            </div>
            {perms.audit && <Button variant="outline" size="sm" onClick={onAudit} loading={busy} loadingText="Analyzing…">Re-run audit</Button>}
          </div>
          {a.overallScore != null && (
            <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {SCORE_CATEGORIES.map((c) => (
                <div key={c}>
                  <button className="w-full text-left" onClick={() => setOpen(open === c ? null : c)} aria-expanded={open === c}>
                    <ScoreBar label={SCORE_CATEGORY_LABEL[c]} value={scores[c]} />
                  </button>
                  {open === c && (
                    <ul className="mt-2 space-y-1.5 rounded-lg bg-subtle/70 p-3 text-xs">
                      {(breakdown[c] ?? []).map((chk: any) => (
                        <li key={chk.id} className="flex gap-2">
                          {chk.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />}
                          <span><span className="font-medium">{chk.label}</span>{chk.max > 0 && <span className="text-faint"> ({chk.earned}/{chk.max})</span>} — <span className="text-muted">{chk.evidence}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          {a.overallScore != null && <p className="mt-4 text-xs text-faint">Click a category to see exactly which checks produced its score. Overall = weighted average (conversion 18%, mobile 15%, content 13%, design/performance/SEO 12%, trust 10%, functionality 8%).</p>}
        </Card>
        <Card>
          <CardHeader title="Findings" description="Each finding is labelled Verified (observed), Inferred (opportunity) or Unknown." action={positives.length > 0 && <Button size="sm" variant="ghost" onClick={() => setShowPositive((v) => !v)}>{showPositive ? "Hide" : "Show"} what works ({positives.length})</Button>} />
          <ul className="divide-y divide-border">
            {[...issues, ...(showPositive ? positives : [])].map((f: any) => {
              const s = SEV[f.severity] ?? SEV.LOW;
              const Icon = s.icon;
              return (
                <li key={f.id} className="flex gap-3 px-5 py-3">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", f.severity === "POSITIVE" ? "text-success" : f.severity === "CRITICAL" || f.severity === "HIGH" ? "text-danger" : "text-warning")} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{f.title}<Badge tone={s.tone}>{s.label}</Badge><span title={KIND[f.kind]?.title}><Badge tone={KIND[f.kind]?.tone}>{KIND[f.kind]?.label}</Badge></span><span className="text-xs font-normal text-faint">{SCORE_CATEGORY_LABEL[f.category as keyof typeof SCORE_CATEGORY_LABEL] ?? f.category}</span></div>
                    <p className="mt-0.5 text-[13px] text-muted">{f.detail}</p>
                  </div>
                </li>
              );
            })}
            {issues.length === 0 && !showPositive && <li className="px-5 py-8 text-center text-sm text-muted">No issues found.</li>}
          </ul>
        </Card>
      </div>
      <div className="space-y-5">
        {ex.ai?.summary && (
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-accent" /> What the site says</div>
            <p className="text-sm text-muted">{ex.ai.summary}</p>
            {ex.ai.services?.length > 0 && <ul className="mt-3 space-y-1.5">{ex.ai.services.map((s: any) => <li key={s.name} className="text-xs"><span className="font-medium">{s.name}</span> <span className="text-faint">“{s.evidence}”</span></li>)}</ul>}
            <p className="mt-3 text-[11px] text-faint">Extracted by AI and verified: every item quotes text that exists on the site.</p>
          </Card>
        )}
        <Card>
          <CardHeader title="Detected on the site" />
          <dl className="divide-y divide-border px-5 text-sm">
            <Fact label="Platform" value={ex.platform} />
            <Fact label="Title" value={ex.title} />
            <Fact label="Main heading" value={ex.h1?.[0]} />
            <Fact label="Calls to action" value={ex.ctas?.length ? ex.ctas.slice(0, 6).join(", ") : null} />
            <Fact label="Forms" value={ex.forms?.length ? ex.forms.map((f: any) => f.purpose).join(", ") : null} />
            <Fact label="Emails" value={ex.emails?.length ? ex.emails.join(", ") : null} />
            <Fact label="Address" value={ex.address} />
            <Fact label="Hours" value={ex.hours} />
            <Fact label="Copyright" value={ex.copyrightYear} />
            <Fact label="Structured data" value={ex.jsonLdTypes?.length ? ex.jsonLdTypes.join(", ") : null} />
          </dl>
        </Card>
        {ex.pagesAnalysed?.length > 0 && (
          <Card>
            <CardHeader title={`Pages analysed (${ex.pagesAnalysed.length})`} />
            <ul className="divide-y divide-border text-sm">
              {ex.pagesAnalysed.map((p: any) => <li key={p.url} className="px-5 py-2"><a href={p.url} target="_blank" rel="noreferrer noopener" className="block truncate text-accent hover:underline">{new URL(p.url).pathname || "/"}</a><span className="text-xs text-faint">{p.words} words</span></li>)}
            </ul>
          </Card>
        )}
        {a.performance && (
          <Card className="p-5">
            <div className="mb-3 text-sm font-semibold">Google Lighthouse (mobile)</div>
            <div className="space-y-3">
              {["performance", "accessibility", "seo", "bestPractices"].map((k) => <ScoreBar key={k} label={k === "bestPractices" ? "Best practices" : k[0]!.toUpperCase() + k.slice(1)} value={a.performance[k]} />)}
            </div>
          </Card>
        )}
        {ex.notes?.length > 0 && <Card className="p-5"><div className="mb-2 text-sm font-semibold">Audit notes</div><ul className="space-y-1 text-xs text-muted">{ex.notes.map((n: string) => <li key={n}>{n}</li>)}</ul></Card>}
      </div>
    </div>
  );
}

export function OpportunityTab({ data }: { data: LeadData }) {
  const o = data.opportunity;
  if (!o) return <Card><EmptyState icon={<Lightbulb className="h-5 w-5" />} title="No opportunity analysis yet" description="Run the website audit to calculate an explainable opportunity score." /></Card>;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card className="p-5">
          <div className="flex items-center gap-5">
            <ScoreRing value={o.score} size={96} label="Opportunity score" />
            <div>
              <div className="text-sm font-semibold">Opportunity score: {o.score}/100</div>
              <p className="mt-1 text-sm text-muted">{o.summary}</p>
              <p className="mt-2 text-xs text-faint">A potential opportunity estimate for prioritisation — not a prediction that the business will gain revenue.</p>
            </div>
          </div>
          <ul className="mt-5 space-y-2">
            {(o.reasons ?? []).map((r: any, i: number) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className={cn("mt-0.5 inline-flex w-12 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", r.points >= 0 ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-red-500/10 text-red-700 dark:text-red-300")}>{r.points >= 0 ? "+" : ""}{r.points}</span>
                <span className="flex-1">{r.label}</span>
                <Badge tone={r.kind === "VERIFIED" ? "blue" : "violet"}>{r.kind === "VERIFIED" ? "Verified" : "Inferred"}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={`What would help a ${data.playbook.label.toLowerCase()}`} description="Features selected for this business type — not every possible feature." />
          <ul className="divide-y divide-border">
            {(o.recommendedFeatures ?? []).map((f: any) => (
              <li key={f.key} className="flex items-start gap-3 px-5 py-3">
                {f.status === "present" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : f.status === "missing" ? <Plus className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-faint" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{f.name}<Badge tone={f.priority === "essential" ? "indigo" : f.priority === "recommended" ? "slate" : "zinc"}>{f.priority}</Badge><span className="text-xs font-normal text-faint">{f.status === "present" ? "Already on site" : f.status === "missing" ? "Not detected" : "Unknown"}</span></div>
                  <p className="mt-0.5 text-[13px] text-muted">{f.why}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="h-fit p-5">
        <div className="text-sm font-semibold">Business type intelligence</div>
        <p className="mt-2 text-sm"><span className="text-muted">Classified as</span> <span className="font-medium">{data.playbook.label}</span> <span className="text-xs text-faint">({data.business.businessTypeConfidence ?? "?"}% confidence)</span></p>
        <ul className="mt-2 space-y-1 text-xs text-muted">{data.typeEvidence.map((e) => <li key={e}>• {e}</li>)}</ul>
        <div className="mt-4 text-sm"><span className="text-muted">Primary goal:</span> {data.playbook.primaryGoal}</div>
        <div className="mt-2 text-sm"><span className="text-muted">Main conversion:</span> {data.playbook.primaryConversion}</div>
        <p className="mt-4 text-xs text-faint">Wrong type? Change it via Edit details — prompts and opportunity will use your choice.</p>
      </Card>
    </div>
  );
}

export function PromptTab({ data, perms, onGenerate, busy }: { data: LeadData; perms: LeadPerms; onGenerate: () => void; busy: boolean }) {
  const toast = useToast();
  const p = data.prompt;
  if (!p || !p.latest) return <Card><EmptyState icon={<FileCode2 className="h-5 w-5" />} title="No website prompt yet" description="Generate an extremely detailed, business-specific website-development specification you can paste into Claude Code, Lovable, Replit or Cursor." action={perms.prompt && <Button onClick={onGenerate} loading={busy} loadingText="Generating prompt…">Generate website prompt</Button>} /></Card>;
  return (
    <Card>
      <CardHeader
        title={p.title}
        description={`Version ${p.latest.version} · ${p.latest.wordCount.toLocaleString()} words · ${p.latest.generator === "AI" ? "AI-enhanced" : p.latest.generator === "MANUAL" ? "Manually edited" : "Rule-based"} · updated $<RelTime d={p.updatedAt} />`}
        action={<>
          <Badge tone={(p.qualityScore ?? 0) >= 85 ? "green" : "amber"}>Quality {p.qualityScore ?? "—"}/100</Badge>
          <Button size="sm" variant="outline" onClick={async () => { const r = await fetch(`/api/prompts/${p.id}/download`); const t = await r.text(); await navigator.clipboard.writeText(t); toast.success("Full prompt copied"); }}><Copy className="h-4 w-4" /> Copy</Button>
          <ButtonLink size="sm" href={`/prompts/${p.id}`}><FileCode2 className="h-4 w-4" /> Open editor</ButtonLink>
        </>}
      />
      <pre className="relative max-h-[420px] overflow-hidden whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-relaxed text-muted">
        {p.latest.content}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />
      </pre>
      <div className="flex justify-center border-t border-border p-3"><ButtonLink variant="ghost" size="sm" href={`/prompts/${p.id}`}>Read the full prompt <ChevronDown className="h-4 w-4 -rotate-90" /></ButtonLink></div>
    </Card>
  );
}
