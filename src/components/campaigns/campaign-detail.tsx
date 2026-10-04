"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Compass, Gauge, Mail, Pause, Play, Settings2, Trash2, X } from "lucide-react";
import { Card, CardHeader, EmptyState, Badge, ScoreBadge, PageHeader } from "../ui/misc";
import { Button, ButtonLink } from "../ui/button";
import { Dialog, ConfirmDialog } from "../ui/dialog";
import { Field, Input } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";
import { StatusBadge, WebsiteBadge } from "../leads/status-badge";
import { CampaignFields, toBody, type CampaignValues } from "./campaign-form";

export function CampaignDetail({ campaign: c, stats, leads, templates, perms }: { campaign: any; stats: Record<string, number>; leads: any[]; templates: { id: string; name: string }[]; perms: { manage: boolean; del: boolean; send: boolean } }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [v, setV] = useState<CampaignValues>({ name: c.name, description: c.description, status: c.status, templateId: c.templateId ?? "", promptStrategy: c.promptStrategy, followUpDays: c.followUpDays.join(", "), followUpMode: c.followUpMode, location: c.searchSettings?.location ?? "", category: c.searchSettings?.category ?? "" });
  const ids = leads.map((l) => l.id);
  const act = async (key: string, fn: () => Promise<any>, ok: string) => { setBusy(key); try { await fn(); toast.success(ok); router.refresh(); } catch (e) { toast.error("Action failed", (e as Error).message); } finally { setBusy(null); } };
  const funnel = [["Businesses found", stats.found], ["Qualified (opp ≥ 70)", stats.qualified], ["Contacted", stats.contacted], ["Delivered", stats.delivered], ["Responses", stats.responses], ["Interested", stats.interested], ["Meetings", stats.meetings], ["Won", stats.won], ["Lost", stats.lost]] as const;
  const max = Math.max(1, stats.found);
  return (
    <div>
      <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Campaigns</Link>
      <PageHeader title={c.name} description={c.description || undefined} eyebrow={<Badge tone={{ DRAFT: "zinc", ACTIVE: "green", PAUSED: "amber", COMPLETED: "slate" }[c.status as string] as any}>{c.status.toLowerCase()}</Badge>}
        actions={perms.manage && <>
          {c.status === "ACTIVE" ? <Button variant="outline" onClick={() => act("st", () => apiFetch(`/api/campaigns/${c.id}`, { method: "PATCH", body: { status: "PAUSED" } }), "Campaign paused — follow-ups held")} loading={busy === "st"}><Pause className="h-4 w-4" /> Pause</Button> : <Button variant="outline" onClick={() => act("st", () => apiFetch(`/api/campaigns/${c.id}`, { method: "PATCH", body: { status: "ACTIVE" } }), "Campaign active")} loading={busy === "st"}><Play className="h-4 w-4" /> Activate</Button>}
          <Button variant="outline" onClick={() => setEditing(true)}><Settings2 className="h-4 w-4" /> Settings</Button>
          <ButtonLink href={`/discover?campaignId=${c.id}`}><Compass className="h-4 w-4" /> Find businesses</ButtonLink>
          {perms.del && <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label="Delete campaign"><Trash2 className="h-4 w-4" /></Button>}
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Campaign funnel" />
          <ul className="space-y-2.5 px-5 py-4">
            {funnel.map(([l, n]) => <li key={l} className="text-sm"><div className="mb-1 flex justify-between"><span className="text-muted">{l}</span><span className="font-medium tabular-nums">{n}</span></div><div className="h-1.5 rounded-full bg-subtle"><div className="h-full rounded-full bg-accent/80" style={{ width: `${(n / max) * 100}%` }} /></div></li>)}
          </ul>
          <div className="border-t border-border px-5 py-3 text-xs text-muted">Follow-ups: day {c.followUpDays.join(", day ")} · {c.followUpMode === "AUTOMATIC" ? "automatic" : "approval required"}</div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={`Businesses (${leads.length})`} action={perms.manage && leads.length > 0 && <>
            <Button size="sm" variant="outline" loading={busy === "audit"} onClick={() => act("audit", () => apiFetch("/api/leads/bulk", { body: { action: "audit", ids } }).then(kickJobs), "Analysing websites in the background")}><Gauge className="h-4 w-4" /> Analyze all</Button>
            <Button size="sm" variant="outline" loading={busy === "emails"} onClick={() => act("emails", () => apiFetch("/api/leads/bulk", { body: { action: "emails", ids, templateId: c.templateId, campaignId: c.id } }).then(kickJobs), "Generating outreach drafts in the background")}><Mail className="h-4 w-4" /> Generate emails</Button>
          </>} />
          {leads.length === 0 ? <EmptyState title="No businesses in this campaign" description="Run a discovery search into this campaign, or add leads from the Leads table (select → More → Add to campaign)." action={<ButtonLink href={`/discover?campaignId=${c.id}`}>Find businesses</ButtonLink>} /> : (
            <ul className="divide-y divide-border">
              {leads.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1"><Link href={`/leads/${l.id}`} className="font-medium hover:text-accent">{l.name}</Link><div className="text-xs text-muted">{l.city ?? "—"} · {l.email ?? "no email"}</div></div>
                  <WebsiteBadge websiteClass={l.websiteClass} websiteStatus={l.websiteStatus} />
                  <span className="w-10 text-right"><ScoreBadge score={l.opportunityScore} /></span>
                  <StatusBadge status={l.status} />
                  {perms.manage && <button aria-label={`Remove ${l.name}`} className="text-faint hover:text-danger" onClick={() => act("rm", () => apiFetch(`/api/campaigns/${c.id}/leads`, { body: { remove: [l.id] } }), "Removed from campaign")}><X className="h-4 w-4" /></button>}
                </li>
              ))}
            </ul>
          )}
          {perms.send && leads.length > 0 && <p className="border-t border-border px-5 py-3 text-xs text-muted">To send: select these leads in <Link href={`/leads?campaignId=${c.id}`} className="text-accent hover:underline">Leads</Link> and use Send — you&apos;ll confirm the exact number of emails first.</p>}
        </Card>
      </div>
      <Dialog open={editing} onClose={() => setEditing(false)} title="Campaign settings" size="lg" footer={<><Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button><Button loading={busy === "save"} onClick={async () => { await act("save", () => apiFetch(`/api/campaigns/${c.id}`, { method: "PATCH", body: toBody(v) }), "Campaign saved"); setEditing(false); }}>Save</Button></>}>
        <CampaignFields v={v} set={(k, val) => setV((s) => ({ ...s, [k]: val }))} templates={templates} />
      </Dialog>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Delete campaign?" confirmLabel="Delete campaign" confirmDisabled={confirmName !== c.name} loading={busy === "del"} onConfirm={() => act("del", async () => { await apiFetch(`/api/campaigns/${c.id}`, { method: "DELETE", body: { confirmName } }); router.push("/campaigns"); }, "Campaign deleted")} description="Leads are kept; only the campaign grouping is removed and its pending follow-ups are cancelled.">
        <Field label={`Type “${c.name}” to confirm`} htmlFor="dc" className="mt-3"><Input id="dc" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}
