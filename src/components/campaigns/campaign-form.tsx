"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, Select, Textarea } from "../ui/form";
import { Alert } from "../ui/misc";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

export type CampaignValues = { name: string; description: string; status: string; templateId: string; promptStrategy: string; followUpDays: string; followUpMode: string; location: string; category: string };

export function CampaignFields({ v, set, templates }: { v: CampaignValues; set: (k: keyof CampaignValues, val: string) => void; templates: { id: string; name: string }[] }) {
  const on = (k: keyof CampaignValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="c-n" required className="sm:col-span-2"><Input id="c-n" value={v.name} onChange={on("name")} placeholder="Mississauga Restaurants October 2026" data-autofocus /></Field>
      <Field label="Description" htmlFor="c-d" className="sm:col-span-2"><Input id="c-d" value={v.description} onChange={on("description")} /></Field>
      <Field label="Target location" htmlFor="c-l" hint="Saved as search settings."><Input id="c-l" value={v.location} onChange={on("location")} placeholder="Mississauga, Ontario" /></Field>
      <Field label="Target category" htmlFor="c-c"><Input id="c-c" value={v.category} onChange={on("category")} placeholder="Restaurants" /></Field>
      <Field label="Email template" htmlFor="c-t"><Select id="c-t" value={v.templateId} onChange={on("templateId")}><option value="">Default</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      <Field label="Status" htmlFor="c-s"><Select id="c-s" value={v.status} onChange={on("status")}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="COMPLETED">Completed</option></Select></Field>
      <Field label="Follow-up days" htmlFor="c-f" hint="Days after first email, e.g. 4, 10. Capped by workspace maximum."><Input id="c-f" value={v.followUpDays} onChange={on("followUpDays")} /></Field>
      <Field label="Follow-up mode" htmlFor="c-m"><Select id="c-m" value={v.followUpMode} onChange={on("followUpMode")}><option value="APPROVAL">Approval required</option><option value="AUTOMATIC">Automatic (if enabled in Automation)</option></Select></Field>
      <Field label="Prompt strategy" htmlFor="c-p" className="sm:col-span-2" hint="Extra instructions added to every website prompt generated for this campaign."><Textarea id="c-p" value={v.promptStrategy} onChange={on("promptStrategy")} placeholder="Emphasise online ordering and mobile menus." /></Field>
    </div>
  );
}

export const toBody = (v: CampaignValues) => ({
  name: v.name, description: v.description, status: v.status, templateId: v.templateId || null, promptStrategy: v.promptStrategy,
  followUpDays: v.followUpDays.split(",").map((x) => Number(x.trim())).filter((n) => n > 0), followUpMode: v.followUpMode,
  searchSettings: { location: v.location, category: v.category },
});

export function NewCampaignButton({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<CampaignValues>({ name: "", description: "", status: "DRAFT", templateId: "", promptStrategy: "", followUpDays: "4, 10", followUpMode: "APPROVAL", location: "", category: "" });
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New campaign</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New campaign" size="lg" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={v.name.trim().length < 2} onClick={async () => {
        setBusy(true); setError(null);
        try { const r = await apiFetch<{ id: string }>("/api/campaigns", { body: toBody(v) }); toast.success("Campaign created"); router.push(`/campaigns/${r.id}`); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Create campaign</Button></>}>
        {error && <Alert tone="danger" title={error} className="mb-4" />}
        <CampaignFields v={v} set={(k, val) => setV((s) => ({ ...s, [k]: val }))} templates={templates} />
      </Dialog>
    </>
  );
}
