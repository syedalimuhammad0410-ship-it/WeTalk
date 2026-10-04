"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/form";
import { Alert } from "../ui/misc";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import type { LeadData } from "./types";

export function EditLeadDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: LeadData }) {
  const router = useRouter();
  const b = data.business;
  const init = { name: b.name ?? "", category: b.category ?? "", businessType: b.businessType ?? "general", address: b.address ?? "", city: b.city ?? "", region: b.region ?? "", phone: b.phone ?? "", website: b.website ?? "", email: b.email ?? "", emailSource: b.emailSource ?? "", assignedToId: b.assignedToId ?? "" };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} title="Edit lead" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => {
      setBusy(true); setError(null);
      try {
        const patch: Record<string, unknown> = {};
        for (const k of Object.keys(f) as (keyof typeof f)[]) if (f[k] !== init[k]) patch[k] = f[k] === "" && k !== "name" ? null : f[k];
        if (patch.email === null) patch.email = "";
        if (Object.keys(patch).length) await apiFetch(`/api/leads/${b.id}`, { method: "PATCH", body: patch });
        onClose(); router.refresh();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>Save changes</Button></>}>
      {error && <Alert tone="danger" title={error} className="mb-4" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="e-n" className="sm:col-span-2"><Input id="e-n" value={f.name} onChange={set("name")} /></Field>
        <Field label="Category" htmlFor="e-c"><Input id="e-c" value={f.category} onChange={set("category")} /></Field>
        <Field label="Business type" htmlFor="e-t" hint="Drives audits, prompts and outreach."><Select id="e-t" value={f.businessType} onChange={set("businessType")}><option value="general">General local business</option>{data.businessTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
        <Field label="Address" htmlFor="e-a" className="sm:col-span-2"><Input id="e-a" value={f.address} onChange={set("address")} /></Field>
        <Field label="City" htmlFor="e-ci"><Input id="e-ci" value={f.city} onChange={set("city")} /></Field>
        <Field label="Region" htmlFor="e-r"><Input id="e-r" value={f.region} onChange={set("region")} /></Field>
        <Field label="Phone" htmlFor="e-p"><Input id="e-p" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Website" htmlFor="e-w"><Input id="e-w" value={f.website} onChange={set("website")} /></Field>
        <Field label="Email" htmlFor="e-e"><Input id="e-e" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Email source" htmlFor="e-es"><Input id="e-es" value={f.emailSource} onChange={set("emailSource")} placeholder="Where this email was found" /></Field>
        <Field label="Assigned to" htmlFor="e-as"><Select id="e-as" value={f.assignedToId} onChange={set("assignedToId")}><option value="">Unassigned</option>{data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
      </div>
    </Dialog>
  );
}

export function TagEditor({ businessId, tags, allTags, disabled }: { businessId: string; tags: string[]; allTags: string[]; disabled?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const save = async (names: string[]) => {
    try {
      await apiFetch(`/api/leads/${businessId}/tags`, { method: "PUT", body: { names } });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-border">
          {t}
          {!disabled && <button onClick={() => save(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="text-faint hover:text-danger"><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {!disabled && (adding ? (
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) save([...tags, value.trim()]); setValue(""); setAdding(false); }}>
          <input autoFocus list="all-tags" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setAdding(false)} className="h-6 w-28 rounded-md border border-border bg-surface px-1.5 text-xs" aria-label="New tag" />
          <datalist id="all-tags">{allTags.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted ring-1 ring-inset ring-dashed ring-border hover:text-fg"><Plus className="h-3 w-3" /> Tag</button>
      ))}
    </div>
  );
}
