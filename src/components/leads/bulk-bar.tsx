"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, FileCode2, Gauge, GitCompare, Mail, MoreHorizontal, Send, Tag, Trash2, UserPlus, X, Download, Megaphone, ArrowRightLeft } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, ConfirmDialog } from "../ui/dialog";
import { Field, Input, Select } from "../ui/form";
import { Alert } from "../ui/misc";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";
import { LEAD_STATUSES, LEAD_STATUS_META } from "@/lib/constants";
import type { Options, Perms } from "./leads-view";

type Mode = null | "assign" | "tag" | "status" | "campaign" | "emails" | "send" | "delete";

export function BulkBar({ ids, options, perms, onDone, onClear }: { ids: string[]; options: Options; perms: Perms; onDone: () => void; onClear: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<{ sendable: number; missingDraftsOrBlocked: number; recipients: string[] } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [more, setMore] = useState(false);

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const r = await apiFetch<{ jobId?: string; message?: string }>("/api/leads/bulk", { body: { ids, ...body } });
      if (r.jobId) kickJobs();
      toast.success(success, r.message);
      setMode(null);
      onDone();
    } catch (e) {
      toast.error("Bulk action failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const close = () => { setMode(null); setValue(""); setConfirmText(""); setPreview(null); };
  return (
    <>
      <div className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-3xl animate-fade-in flex-wrap items-center gap-1 rounded-2xl border border-border bg-surface p-2 shadow-pop lg:bottom-6" role="toolbar" aria-label="Bulk actions">
        <span className="px-2 text-sm font-medium tabular-nums">{ids.length} selected</span>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        {perms.edit && <Button size="sm" variant="ghost" onClick={() => run({ action: "audit" }, `Analysing ${ids.length} websites in the background`)} disabled={busy}><Gauge className="h-4 w-4" /> Analyse</Button>}
        {perms.edit && <Button size="sm" variant="ghost" onClick={() => run({ action: "prompts" }, `Generating ${ids.length} prompts in the background`)} disabled={busy}><FileCode2 className="h-4 w-4" /> Prompts</Button>}
        {perms.edit && <Button size="sm" variant="ghost" onClick={() => setMode("emails")}><Mail className="h-4 w-4" /> Emails</Button>}
        {perms.send && (
          <Button size="sm" variant="ghost" onClick={async () => { setMode("send"); try { setPreview(await apiFetch("/api/leads/bulk", { body: { action: "preview_send", ids } })); } catch (e) { toast.error((e as Error).message); setMode(null); } }}>
            <Send className="h-4 w-4" /> Send
          </Button>
        )}
        <div className="relative">
          <Button size="sm" variant="ghost" onClick={() => setMore((v) => !v)} aria-expanded={more}><MoreHorizontal className="h-4 w-4" /> More</Button>
          {more && (
            <div className="absolute bottom-11 left-0 z-50 w-52 rounded-xl border border-border bg-surface p-1 shadow-pop" onClick={() => setMore(false)}>
              {perms.edit && <MenuItem icon={UserPlus} label="Assign" onClick={() => setMode("assign")} />}
              {perms.edit && <MenuItem icon={Tag} label="Add tag" onClick={() => setMode("tag")} />}
              {perms.status && <MenuItem icon={ArrowRightLeft} label="Change status" onClick={() => setMode("status")} />}
              {perms.edit && <MenuItem icon={Megaphone} label="Add to campaign" onClick={() => setMode("campaign")} />}
              {perms.edit && <MenuItem icon={Archive} label="Archive" onClick={() => run({ action: "archive", archived: true }, "Archived")} />}
              {ids.length >= 2 && ids.length <= 4 && <MenuItem icon={GitCompare} label="Compare" onClick={() => router.push(`/leads/compare?ids=${ids.join(",")}`)} />}
              {perms.exp && <MenuItem icon={Download} label="Export selected" onClick={() => { window.location.href = `/api/leads/export?ids=${ids.join(",")}`; }} />}
              {perms.del && <MenuItem icon={Trash2} label="Delete…" danger onClick={() => setMode("delete")} />}
            </div>
          )}
        </div>
        <button onClick={onClear} className="ml-auto rounded-lg p-1.5 text-faint hover:bg-subtle hover:text-fg" aria-label="Clear selection"><X className="h-4 w-4" /></button>
      </div>

      <Dialog open={mode === "assign" || mode === "tag" || mode === "status" || mode === "campaign" || mode === "emails"} onClose={close} title={{ assign: "Assign leads", tag: "Add tag", status: "Change status", campaign: "Add to campaign", emails: "Generate outreach emails" }[mode as "assign"] ?? ""} description={`${ids.length} lead(s) selected.`}
        footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button loading={busy} disabled={mode !== "emails" && mode !== "assign" && !value} onClick={() => {
          if (mode === "assign") run({ action: "assign", userId: value || null }, "Leads assigned");
          if (mode === "tag") run({ action: "tag", tag: value }, `Tagged “${value}”`);
          if (mode === "status") run({ action: "status", status: value }, "Status updated");
          if (mode === "campaign") run({ action: "campaign", campaignId: value }, "Added to campaign");
          if (mode === "emails") run({ action: "emails", templateId: value || null }, `Generating emails in the background`);
        }}>Apply</Button></>}>
        {mode === "assign" && <Field label="Assignee" htmlFor="b-a"><Select id="b-a" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Unassigned</option>{options.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>}
        {mode === "tag" && <Field label="Tag" htmlFor="b-t" hint="Existing or new tag name."><Input id="b-t" list="tag-list" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus /><datalist id="tag-list">{options.tags.map((t) => <option key={t.id} value={t.name} />)}</datalist></Field>}
        {mode === "status" && <Field label="New status" htmlFor="b-s" hint="Do-Not-Contact leads are skipped — reversing that requires an individual, logged reason."><Select id="b-s" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Choose…</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_META[s].label}</option>)}</Select></Field>}
        {mode === "campaign" && (options.campaigns.length ? <Field label="Campaign" htmlFor="b-c"><Select id="b-c" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Choose…</option>{options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field> : <Alert tone="info" title="No campaigns yet" />)}
        {mode === "emails" && <div className="space-y-3"><p className="text-sm text-muted">Creates a personalised draft for each lead (nothing is sent). Do-Not-Contact leads are skipped.</p><Field label="Template (used when AI is off or unavailable)" htmlFor="b-tp"><Select id="b-tp" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Default outreach template</option>{options.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field></div>}
      </Dialog>

      <ConfirmDialog
        open={mode === "send"}
        onClose={close}
        tone="primary"
        title="Send outreach emails"
        confirmLabel={preview ? `Send ${preview.sendable} email${preview.sendable === 1 ? "" : "s"}` : "Send"}
        confirmDisabled={!preview || preview.sendable === 0 || confirmText !== String(preview.sendable)}
        loading={busy}
        onConfirm={() => preview && run({ action: "send", confirmCount: preview.sendable }, `Sending ${preview.sendable} emails (spaced by your minimum delay)`)}
        description={preview ? `Exactly ${preview.sendable} email(s) will be sent. ${preview.missingDraftsOrBlocked} selected lead(s) have no ready draft, no email, or are Do Not Contact and will be skipped. Daily/hourly limits still apply.` : "Checking drafts…"}
      >
        {preview && preview.sendable > 0 && (
          <div className="mt-3 space-y-3">
            <ul className="max-h-32 overflow-y-auto rounded-lg bg-subtle p-2 font-mono text-xs text-muted">{preview.recipients.map((r) => <li key={r}>{r}</li>)}{preview.sendable > preview.recipients.length && <li>…and {preview.sendable - preview.recipients.length} more</li>}</ul>
            <Field label={`Type ${preview.sendable} to confirm`} htmlFor="b-conf"><Input id="b-conf" inputMode="numeric" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog open={mode === "delete"} onClose={close} title={`Delete ${ids.length} leads?`} confirmLabel="Delete permanently" loading={busy} confirmDisabled={confirmText !== String(ids.length)} onConfirm={() => run({ action: "delete", confirmCount: ids.length }, "Leads deleted")} description="This permanently deletes the selected leads with their audits, prompts, conversations and notes. Do-not-contact suppressions are kept. This cannot be undone.">
        <Field label={`Type ${ids.length} to confirm`} htmlFor="b-del" className="mt-3"><Input id="b-del" inputMode="numeric" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-subtle ${danger ? "text-danger" : ""}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
