"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, Badge, EmptyState, Alert } from "../ui/misc";
import { Button } from "../ui/button";
import { Dialog, ConfirmDialog } from "../ui/dialog";
import { Field, Input, Select, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { TEMPLATE_VARIABLES } from "@/lib/constants";

type T = { id: string; name: string; kind: "OUTREACH" | "FOLLOW_UP" | "REPLY"; subject: string; body: string };
const KIND = { OUTREACH: "Outreach", FOLLOW_UP: "Follow-up", REPLY: "Reply" } as const;

export function TemplatesView({ templates, leads, canEdit }: { templates: T[]; leads: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<T | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const blank: T = { id: "", name: "", kind: "OUTREACH", subject: "", body: "" };
  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => setEditing(blank)}><Plus className="h-4 w-4" /> New template</Button></div>}
      {templates.length === 0 && <Card><EmptyState title="No templates" /></Card>}
      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-2"><div className="font-semibold">{t.name}</div><Badge tone={t.kind === "OUTREACH" ? "indigo" : t.kind === "FOLLOW_UP" ? "orange" : "slate"}>{KIND[t.kind]}</Badge></div>
            <div className="mt-2 text-sm font-medium text-muted">{t.subject}</div>
            <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-[13px] text-muted">{t.body}</p>
            <div className="mt-auto flex gap-1 pt-4">
              <Button size="sm" variant="outline" onClick={() => setEditing(t)}>{canEdit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{canEdit ? "Edit & preview" : "Preview"}</Button>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing({ ...t, id: "", name: `${t.name} (copy)` })}><Copy className="h-4 w-4" /> Duplicate</Button>}
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </Card>
        ))}
      </div>
      {editing && <TemplateEditor t={editing} leads={leads} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} title={`Delete “${deleting?.name}”?`} confirmLabel="Delete" loading={busy} onConfirm={async () => { setBusy(true); try { await apiFetch(`/api/templates/${deleting!.id}`, { method: "DELETE" }); toast.success("Template deleted"); setDeleting(null); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }} />
    </div>
  );
}

function TemplateEditor({ t, leads, canEdit, onClose, onSaved }: { t: T; leads: { id: string; name: string }[]; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(t);
  const [lead, setLead] = useState(leads[0]?.id ?? "");
  const [preview, setPreview] = useState<{ subject: string; body: string; missing: string[]; sample: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const h = setTimeout(() => apiFetch<typeof preview>("/api/templates/preview", { body: { subject: v.subject, body: v.body, businessId: lead || null } }).then(setPreview).catch(() => {}), 300);
    return () => clearTimeout(h);
  }, [v.subject, v.body, lead]);
  const insert = (name: string) => {
    const el = bodyRef.current;
    const tok = `{{${name}}}`;
    if (!el) return setV((s) => ({ ...s, body: s.body + tok }));
    const [a, b] = [el.selectionStart, el.selectionEnd];
    setV((s) => ({ ...s, body: s.body.slice(0, a) + tok + s.body.slice(b) }));
    setTimeout(() => { el.focus(); el.setSelectionRange(a + tok.length, a + tok.length); }, 0);
  };
  return (
    <Dialog open onClose={onClose} title={t.id ? (canEdit ? "Edit template" : t.name) : "New template"} size="xl" footer={<><Button variant="outline" onClick={onClose}>Close</Button>{canEdit && <Button loading={busy} disabled={!v.name || !v.subject || !v.body} onClick={async () => {
      setBusy(true);
      try { const body = { name: v.name, kind: v.kind, subject: v.subject, body: v.body }; if (t.id) await apiFetch(`/api/templates/${t.id}`, { method: "PATCH", body }); else await apiFetch("/api/templates", { body }); toast.success("Template saved"); onSaved(); }
      catch (e) { toast.error("Not saved", (e as Error).message); } finally { setBusy(false); }
    }}>Save template</Button>}</>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" htmlFor="t-n"><Input id="t-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} readOnly={!canEdit} /></Field>
            <Field label="Type" htmlFor="t-k"><Select id="t-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as T["kind"] })} disabled={!canEdit}><option value="OUTREACH">Outreach</option><option value="FOLLOW_UP">Follow-up</option><option value="REPLY">Reply</option></Select></Field>
          </div>
          <Field label="Subject" htmlFor="t-s"><Input id="t-s" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} readOnly={!canEdit} /></Field>
          <Field label="Body" htmlFor="t-b"><Textarea id="t-b" ref={bodyRef} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className="min-h-[260px]" readOnly={!canEdit} /></Field>
          {canEdit && <div><div className="label text-xs text-muted">Insert variable</div><div className="flex flex-wrap gap-1.5">{TEMPLATE_VARIABLES.map((x) => <button key={x} type="button" onClick={() => insert(x)} className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] hover:bg-subtle">{`{{${x}}}`}</button>)}</div></div>}
        </div>
        <div className="space-y-3">
          <Field label="Preview with lead" htmlFor="t-l"><Select id="t-l" value={lead} onChange={(e) => setLead(e.target.value)}><option value="">Sample values</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          {preview?.missing.length ? <Alert tone="warning" title="Missing for this lead">{preview.missing.map((m) => `{{${m}}}`).join(", ")} — will stay visible and block sending until edited.</Alert> : null}
          <div className="rounded-xl border border-border bg-subtle/50 p-4">
            <div className="text-sm font-semibold">{preview?.subject}</div>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed">{preview?.body}</pre>
          </div>
          <p className="text-xs text-muted">{"{{top_issue}}"} and {"{{top_opportunity}}"} come only from verified audit findings, so the email never makes a generic or invented claim.</p>
        </div>
      </div>
    </Dialog>
  );
}
