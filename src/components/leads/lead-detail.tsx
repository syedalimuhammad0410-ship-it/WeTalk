"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Archive, ExternalLink, FileCode2, Gauge, Globe, Mail, MapPin, MoreHorizontal, Pencil, Phone, ShieldOff, Trash2, Star } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/misc";
import { Tabs } from "../ui/tabs";
import { Select } from "../ui/form";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { Field, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { LEAD_STATUSES, LEAD_STATUS_META, type LeadStatusT } from "@/lib/constants";
import { StatusBadge, WebsiteBadge } from "./status-badge";
import { OverviewTab, AuditTab, OpportunityTab, PromptTab } from "./lead-sections";
import { EmailsTab } from "./lead-outreach";
import { ConversationTab, FollowUpsTab, ActivityTab, NotesTab } from "./lead-misc";
import { EditLeadDialog, TagEditor } from "./lead-edit";
import type { LeadData, LeadPerms } from "./types";

const TABS = ["overview", "audit", "opportunity", "prompt", "emails", "conversation", "followups", "activity", "notes"] as const;
type Tab = (typeof TABS)[number];

export function LeadDetail({ data, initialTab, perms, currentUserId }: { data: LeadData; initialTab: string; perms: LeadPerms; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();
  const b = data.business;
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initialTab) ? (initialTab as Tab) : "overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDnc, setConfirmDnc] = useState(false);
  const [reverse, setReverse] = useState<LeadStatusT | null>(null);
  const [reason, setReason] = useState("");

  const changeTab = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  };

  async function action<T>(key: string, fn: () => Promise<T>, ok: (r: T) => string, after?: (r: T) => void) {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(ok(r));
      after?.(r);
      router.refresh();
    } catch (e) {
      toast.error("Action failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(s: LeadStatusT, why?: string) {
    if (b.status === "DO_NOT_CONTACT" && s !== "DO_NOT_CONTACT" && !why) return setReverse(s);
    await action("status", () => apiFetch(`/api/leads/${b.id}/status`, { body: { status: s, reason: why } }), () => `Status: ${LEAD_STATUS_META[s].label}`);
  }

  const runAudit = () => action("audit", () => apiFetch<{ overall: number | null; classification: string; opportunity: number }>(`/api/leads/${b.id}/audit`, { body: {} }), (r) => (r.overall != null ? `Website scored ${r.overall}/100 · opportunity ${r.opportunity}` : `Website check complete · opportunity ${r.opportunity}`), () => changeTab("audit"));
  const genPrompt = () => action("prompt", () => apiFetch<{ promptId: string; quality: number }>(`/api/leads/${b.id}/prompt`, { body: {} }), (r) => `Website prompt generated (quality ${r.quality}/100)`, (r) => router.push(`/prompts/${r.promptId}`));

  const counts: Partial<Record<Tab, number>> = { conversation: data.conversations.length, followups: data.followUps.filter((f: { status: string }) => ["SCHEDULED", "PENDING_APPROVAL"].includes(f.status)).length, notes: data.notes.length };

  return (
    <div className="space-y-5">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Leads</Link>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{b.name}</h1>
            {b.isDemo && <Badge tone="amber">DEMO DATA</Badge>}
            {b.archived && <Badge tone="zinc">Archived</Badge>}
            {b.doNotContact && <Badge tone="red"><ShieldOff className="h-3 w-3" /> Do not contact</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span>{b.category ?? "Category not found"} · <span className="text-fg">{data.playbook.label}</span></span>
            {(b.city || b.address) && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{b.city ?? b.address}</span>}
            {b.phone && <a href={`tel:${b.phone}`} className="inline-flex items-center gap-1 hover:text-fg"><Phone className="h-3.5 w-3.5" />{b.phone}</a>}
            {b.website ? <a href={b.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-fg"><Globe className="h-3.5 w-3.5" />{b.websiteDomain ?? "Website"}<ExternalLink className="h-3 w-3" /></a> : <span className="inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" />No website</span>}
            {b.rating != null && <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" />{b.rating} ({b.reviewCount ?? 0})</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            <WebsiteBadge websiteClass={b.websiteClass} websiteStatus={b.websiteStatus} />
            <TagEditor businessId={b.id} tags={b.tags.map((t: { tag: { name: string } }) => t.tag.name)} allTags={data.allTags} disabled={!perms.edit} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {perms.status && (
            <Select value={b.status} onChange={(e) => setStatus(e.target.value as LeadStatusT)} disabled={busy === "status"} className="h-9 w-auto py-1" aria-label="Lead status">
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_META[s].label}</option>)}
            </Select>
          )}
          {perms.audit && <Button variant="outline" onClick={runAudit} loading={busy === "audit"} loadingText="Analyzing website…"><Gauge className="h-4 w-4" /> {data.audit ? "Re-analyze" : "Analyze website"}</Button>}
          {perms.prompt && <Button onClick={genPrompt} loading={busy === "prompt"} loadingText="Generating prompt…"><FileCode2 className="h-4 w-4" /> {data.prompt ? "Regenerate prompt" : "Generate website prompt"}</Button>}
          {perms.compose && <Button variant="outline" onClick={() => changeTab("emails")} disabled={b.doNotContact}><Mail className="h-4 w-4" /> Outreach</Button>}
          <div className="relative">
            <Button variant="ghost" size="icon" onClick={() => setMenu((v) => !v)} aria-label="More actions" aria-expanded={menu}><MoreHorizontal className="h-4 w-4" /></Button>
            {menu && (
              <div className="absolute right-0 top-10 z-30 w-56 rounded-xl border border-border bg-surface p-1 shadow-pop" onClick={() => setMenu(false)}>
                {perms.edit && <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-subtle" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit details</button>}
                {perms.edit && <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-subtle" onClick={() => action("archive", () => apiFetch(`/api/leads/${b.id}`, { method: "PATCH", body: { archived: !b.archived } }), () => (b.archived ? "Lead restored" : "Lead archived"))}><Archive className="h-4 w-4" /> {b.archived ? "Unarchive" : "Archive"}</button>}
                {perms.status && !b.doNotContact && <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger hover:bg-subtle" onClick={() => setConfirmDnc(true)}><ShieldOff className="h-4 w-4" /> Do not contact</button>}
                {perms.del && <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger hover:bg-subtle" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /> Delete lead</button>}
              </div>
            )}
          </div>
        </div>
      </header>

      <Tabs<Tab>
        value={tab}
        onChange={changeTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "audit", label: "Website & Audit" },
          { id: "opportunity", label: "Opportunity" },
          { id: "prompt", label: "Prompt" },
          { id: "emails", label: "Emails" },
          { id: "conversation", label: "Conversation", count: counts.conversation },
          { id: "followups", label: "Follow-Ups", count: counts.followups },
          { id: "activity", label: "Activity" },
          { id: "notes", label: "Notes", count: counts.notes },
        ]}
      />
      <div role="tabpanel">
        {tab === "overview" && <OverviewTab data={data} perms={perms} onTab={changeTab} onAudit={runAudit} onPrompt={genPrompt} busy={busy} />}
        {tab === "audit" && <AuditTab data={data} perms={perms} onAudit={runAudit} busy={busy === "audit"} />}
        {tab === "opportunity" && <OpportunityTab data={data} />}
        {tab === "prompt" && <PromptTab data={data} perms={perms} onGenerate={genPrompt} busy={busy === "prompt"} />}
        {tab === "emails" && <EmailsTab data={data} perms={perms} />}
        {tab === "conversation" && <ConversationTab data={data} />}
        {tab === "followups" && <FollowUpsTab data={data} perms={perms} />}
        {tab === "activity" && <ActivityTab data={data} />}
        {tab === "notes" && <NotesTab data={data} perms={perms} currentUserId={currentUserId} />}
      </div>

      <EditLeadDialog open={editing} onClose={() => setEditing(false)} data={data} />
      <ConfirmDialog open={confirmDnc} onClose={() => setConfirmDnc(false)} title="Mark as Do Not Contact?" confirmLabel="Mark Do Not Contact" loading={busy === "status"} onConfirm={async () => { await setStatus("DO_NOT_CONTACT"); setConfirmDnc(false); }} description="This stops all outreach, automated follow-ups and AI replies for this business and adds its email to your suppression list. Reversing it later requires an admin and a recorded reason." />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${b.name}?`} confirmLabel="Delete permanently" loading={busy === "delete"} onConfirm={() => action("delete", () => apiFetch(`/api/leads/${b.id}`, { method: "DELETE", body: { confirm: true } }), () => "Lead deleted", () => router.push("/leads"))} description="Deletes this lead with its audits, prompts, emails, conversations and notes. Suppression entries are kept. This cannot be undone." />
      <Dialog open={Boolean(reverse)} onClose={() => { setReverse(null); setReason(""); }} title="Reverse Do Not Contact?" description="Only do this if the business explicitly asked to be contacted again. The reason is recorded."
        footer={<><Button variant="outline" onClick={() => setReverse(null)}>Cancel</Button><Button disabled={reason.trim().length < 10 || !perms.reverseDnc} onClick={async () => { const s = reverse!; setReverse(null); await setStatus(s, reason.trim()); setReason(""); }}>Reverse</Button></>}>
        {!perms.reverseDnc && <p className="mb-3 text-sm text-danger">Only admins can reverse Do Not Contact.</p>}
        <Field label="Reason" htmlFor="rr" hint="Minimum 10 characters."><Textarea id="rr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
