"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MailSearch, ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader } from "../ui/misc";
import { Button } from "../ui/button";
import { Field, Textarea } from "../ui/form";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { RelTime } from "@/components/ui/time";
import type { LeadData, LeadPerms } from "./types";

const CLASS: Record<string, string> = { VERIFIED_PUBLIC: "Verified public business email", PUBLIC_DIRECTORY: "Public directory email", LICENSED_PROVIDER: "Licensed provider result", MANUAL: "Manually supplied", UNVERIFIED: "Unverified", INVALID: "Invalid" };
const ELIG: Record<string, [string, any]> = { ELIGIBLE: ["Eligible for outreach", "green"], NEEDS_REVIEW: ["Needs consent review", "amber"], INELIGIBLE: ["Not eligible", "red"] };
const BASIS: Record<string, string> = { EXPRESS: "Express consent", IMPLIED_CONSPICUOUS_PUBLICATION: "Implied — conspicuous publication", IMPLIED_EXISTING_RELATIONSHIP: "Implied — existing relationship", NONE: "None documented" };

export function ContactsTab({ data, perms }: { data: LeadData; perms: LeadPerms }) {
  const router = useRouter();
  const toast = useToast();
  const id = data.business.id;
  const [d, setD] = useState<{ contacts: any[]; consent: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentFor, setConsentFor] = useState<any>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => apiFetch<any>(`/api/leads/${id}/contacts`, { method: "GET" }).then(setD).catch(() => setD({ contacts: [], consent: [] })), [id]);
  useEffect(() => { void load(); }, [load]);

  async function discover() {
    setBusy(true);
    try {
      const r = await apiFetch<any>(`/api/leads/${id}/contacts`, { body: { action: "discover" } });
      toast.success(r.found ? `${r.found} public email${r.found === 1 ? "" : "s"} found` : "No public business email found", r.notes?.[0]);
      await load();
      router.refresh();
    } catch (e) {
      toast.error("Search failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const primary = d?.contacts.find((c) => c.isPrimary);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Business emails" description={d ? `${d.contacts.length ? `Email found: yes · ${d.contacts.length} address${d.contacts.length === 1 ? "" : "es"}` : "Email found: no"}${primary ? ` · primary ${primary.email}` : ""}` : "Loading…"} action={perms.edit && <Button size="sm" loading={busy} loadingText="Checking public pages…" onClick={discover}><MailSearch className="h-4 w-4" /> Find public emails</Button>} />
        {d && d.contacts.length === 0 && <p className="px-5 py-6 text-sm text-muted">No email on file. “Find public emails” checks this business&apos;s own homepage, contact and about pages (respecting robots.txt). Addresses are never guessed.</p>}
        <ul className="divide-y divide-border">
          {d?.contacts.map((c) => (
            <li key={c.id} className="space-y-1.5 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.email}</span>
                {c.isPrimary && <Badge tone="indigo">Primary</Badge>}
                <Badge tone={ELIG[c.eligibility]?.[1] ?? "zinc"}>{ELIG[c.eligibility]?.[0] ?? c.eligibility}</Badge>
                <Badge tone={c.verification === "VALID" ? "green" : c.verification === "INVALID" ? "red" : "zinc"}>{c.verification === "VALID" ? "Validated" : c.verification === "INVALID" ? "Invalid" : "Unverified"}</Badge>
              </div>
              <div className="text-xs text-muted">{CLASS[c.classification] ?? c.classification} · {c.role ?? "Role unknown"} · consent basis: {BASIS[c.consentBasis ?? "NONE"] ?? c.consentBasis}</div>
              {c.eligibilityReason && <div className="text-xs">{c.eligibilityReason}</div>}
              <div className="text-xs text-faint">Source: {c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{c.sourceUrl}</a> : c.source}{c.verificationNote ? ` · ${c.verificationNote}` : ""}{c.lastCheckedAt ? <> · checked <RelTime d={c.lastCheckedAt} /></> : null}</div>
              {c.sourceSnippet && <div className="rounded bg-subtle px-2 py-1 text-xs italic text-muted">“{c.sourceSnippet}”</div>}
              {perms.edit && c.eligibility !== "ELIGIBLE" && c.verification !== "INVALID" && <button className="text-xs font-medium text-accent hover:underline" onClick={() => { setConsentFor(c); setNote(""); }}>Record express consent…</button>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> Consent evidence</span>} description="Every eligibility decision is stored with its evidence." />
        <ul className="divide-y divide-border text-xs">
          {(d?.consent ?? []).length === 0 && <li className="px-5 py-4 text-muted">No records yet.</li>}
          {d?.consent.map((r) => (
            <li key={r.id} className="space-y-0.5 px-5 py-2.5">
              <div className="font-medium">{r.email} — {BASIS[r.basis] ?? r.basis}{r.withdrawnAt ? " (withdrawn)" : ""}</div>
              <div className="text-muted">{r.reason}</div>
              <div className="text-faint"><RelTime d={r.createdAt} /></div>
            </li>
          ))}
        </ul>
      </Card>
      <Dialog open={Boolean(consentFor)} onClose={() => setConsentFor(null)} title={`Record express consent for ${consentFor?.email ?? ""}`} description="Only if the business explicitly agreed to receive your messages (e.g. they asked for a quote or signed up). The note is stored as evidence."
        footer={<><Button variant="outline" onClick={() => setConsentFor(null)}>Cancel</Button><Button disabled={note.trim().length < 10} onClick={async () => { try { await apiFetch(`/api/leads/${id}/contacts`, { body: { action: "express_consent", contactId: consentFor.id, note } }); toast.success("Express consent recorded"); setConsentFor(null); await load(); } catch (e) { toast.error("Not saved", (e as Error).message); } }}>Record consent</Button></>}>
        <Field label="How was consent given?" htmlFor="cn" hint="e.g. “Owner asked us by phone on Nov 7 to email a quote.”"><Textarea id="cn" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
