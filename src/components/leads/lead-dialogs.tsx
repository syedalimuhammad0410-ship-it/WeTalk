"use client";
import { useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form";
import { Alert } from "../ui/misc";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

export function AddLeadDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: "", category: "", address: "", city: "", region: "", phone: "", website: "", email: "", emailSource: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} title="Add a business" description="Only enter information you have from a legitimate source. Leave unknown fields blank — they'll show as “Not found”." size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.name.trim()} onClick={async () => {
        setBusy(true); setError(null);
        try { const r = await apiFetch<{ id: string }>("/api/leads", { body: Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())) }); onCreated(r.id); setF({ name: "", category: "", address: "", city: "", region: "", phone: "", website: "", email: "", emailSource: "" }); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Add business</Button></>}>
      {error && <Alert tone="danger" title={error} className="mb-4" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="ln" required className="sm:col-span-2"><Input id="ln" value={f.name} onChange={set("name")} data-autofocus /></Field>
        <Field label="Category" htmlFor="lc"><Input id="lc" value={f.category} onChange={set("category")} placeholder="e.g. Plumber" /></Field>
        <Field label="Phone" htmlFor="lp"><Input id="lp" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Address" htmlFor="la" className="sm:col-span-2"><Input id="la" value={f.address} onChange={set("address")} /></Field>
        <Field label="City" htmlFor="lci"><Input id="lci" value={f.city} onChange={set("city")} /></Field>
        <Field label="Province / state" htmlFor="lr"><Input id="lr" value={f.region} onChange={set("region")} /></Field>
        <Field label="Website" htmlFor="lw"><Input id="lw" value={f.website} onChange={set("website")} placeholder="example.com" /></Field>
        <Field label="Business email" htmlFor="le"><Input id="le" type="email" value={f.email} onChange={set("email")} /></Field>
        {f.email && <Field label="Where did this email come from?" htmlFor="les" className="sm:col-span-2" hint="e.g. “Listed on their website contact page”. Stored for compliance."><Input id="les" value={f.emailSource} onChange={set("emailSource")} /></Field>}
      </div>
    </Dialog>
  );
}

export function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Import leads from CSV" description="Columns: Business (or Name), Category, Address, City, Region, Phone, Website, Email. Duplicates are detected automatically."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} loadingText="Importing…" disabled={!csv} onClick={async () => {
        setBusy(true);
        try { const r = await apiFetch<{ created: number; duplicates: number; skipped: number }>("/api/leads/import", { body: { csv, emailSource: source || undefined } }); toast.success(`Imported ${r.created} leads`, `${r.duplicates} duplicates skipped, ${r.skipped} rows without a name.`); setCsv(""); setFileName(""); onDone(); }
        catch (e) { toast.error("Import failed", (e as Error).message); } finally { setBusy(false); }
      }}>Import</Button></>}>
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center hover:bg-subtle">
          <span className="text-sm font-medium">{fileName || "Choose a CSV file"}</span>
          <span className="mt-1 text-xs text-muted">Up to 5,000 rows</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5_000_000) return toast.error("File too large (max 5 MB)"); setFileName(f.name); setCsv(await f.text()); }} />
        </label>
        <Field label="Source of the email addresses" htmlFor="src" hint="Recorded on each lead for compliance, e.g. “Purchased from XYZ (consented B2B list)”."><Input id="src" value={source} onChange={(e) => setSource(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
