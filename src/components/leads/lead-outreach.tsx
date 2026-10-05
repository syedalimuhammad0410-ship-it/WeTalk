"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Mail, RefreshCcw, Send, Sparkles, Trash2 } from "lucide-react";
import { Card, CardHeader, EmptyState, Badge, Alert } from "../ui/misc";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

import { INTENT_META } from "@/lib/constants";
import { SendConfirmDialog, type SendSummary } from "../email/send-confirm";
import type { LeadData, LeadPerms } from "./types";
import { DateTimeText } from "@/components/ui/time";

export function EmailsTab({ data, perms }: { data: LeadData; perms: LeadPerms }) {
  const router = useRouter();
  const toast = useToast();
  const b = data.business;
  const d = data.draft;
  const [subject, setSubject] = useState<string>(d?.subject ?? "");
  const [body, setBody] = useState<string>(d?.bodyText ?? "");
  const [to, setTo] = useState<string>(d?.toAddress || b.email || "");
  const [templateId, setTemplateId] = useState("");
  const [campaignId, setCampaignId] = useState<string>(d?.campaignId ?? "");
  const [notes, setNotes] = useState<string[]>((d?.analysis?.notes as string[]) ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState<SendSummary | null>(null);
  const alreadyContacted = data.messages.some((m: any) => m.direction === "OUTBOUND" && m.kind === "OUTREACH" && m.status === "SENT");
  const dirty = d && (subject !== d.subject || body !== d.bodyText || to !== (d.toAddress || b.email || "") || campaignId !== (d.campaignId ?? ""));

  async function generate() {
    setBusy("gen");
    try {
      const r = await apiFetch<{ draftId: string; subject: string; body: string; to: string; aiGenerated: boolean; notes: string[] }>(`/api/leads/${b.id}/outreach`, { body: { templateId: templateId || null, campaignId: campaignId || null } });
      setSubject(r.subject);
      setBody(r.body);
      setTo(r.to || to);
      setNotes(r.notes);
      toast.success(r.aiGenerated ? "Personalised email generated with AI" : "Email generated from template");
      router.refresh();
    } catch (e) {
      toast.error("Couldn't generate email", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!d) return;
    await apiFetch(`/api/emails/drafts/${d.id}`, { method: "PATCH", body: { subject, body, to, campaignId: campaignId || null } });
  }

  async function review() {
    setBusy("review");
    try {
      await save();
      const r = await apiFetch<{ confirmRequired?: boolean; summary: SendSummary }>("/api/emails/send", { body: { draftId: d.id, dryRun: true } });
      setSummary(r.summary);
    } catch (e) {
      toast.error("Can't send yet", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    try {
      const r = await apiFetch<{ sent: boolean; sandbox: boolean; conversationId: string }>("/api/emails/send", { body: { draftId: d.id, confirmed: true } });
      toast.success(r.sandbox ? "Recorded in sandbox (not delivered)" : "Email sent", "Follow-ups were scheduled according to your settings.");
      setSummary(null);
      router.refresh();
    } catch (e) {
      toast.error("Email not sent", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {b.doNotContact ? (
          <Alert tone="danger" title="This business is marked Do Not Contact.">Outreach, follow-ups and automatic replies are blocked.</Alert>
        ) : alreadyContacted ? (
          <Alert tone="info" title="Initial outreach already sent">Continue in the conversation, or let scheduled follow-ups handle it. <Link className="text-accent hover:underline" href={data.conversations[0] ? `/inbox/${data.conversations[0].id}` : "/inbox"}>Open conversation →</Link></Alert>
        ) : (
          <Card>
            <CardHeader title="Outreach email" description="Personalised from verified audit observations. Nothing is sent until you confirm." action={perms.compose && (
              <div className="flex items-center gap-2">
                {data.templates.length > 1 && <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-8 w-auto py-0 text-[13px]" aria-label="Template"><option value="">Default template</option>{data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
                <Button size="sm" variant={d ? "outline" : "primary"} onClick={generate} loading={busy === "gen"} loadingText="Generating email…">{d ? <RefreshCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}{d ? "Regenerate" : "Generate email"}</Button>
              </div>
            )} />
            {!d ? (
              <EmptyState icon={<Mail className="h-5 w-5" />} title="No draft yet" description={data.audit ? "Generate an email that references what the audit actually found." : "Tip: run the website audit first so the email can mention specific, verified observations."} />
            ) : (
              <div className="space-y-4 p-5">
                {notes.length > 0 && <Alert tone="warning" title="Before sending">{notes.map((n) => <div key={n}>{n}</div>)}</Alert>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="To" htmlFor="to" hint={b.emailSource ? `Source: ${b.emailSource}` : "No public email found — enter one from a legitimate source."}><Input id="to" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                  <Field label="Campaign" htmlFor="camp"><Select id="camp" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}><option value="">None</option>{data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                </div>
                <Field label="Subject" htmlFor="subj"><Input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
                <Field label="Message" htmlFor="body" hint={d.aiGenerated ? "Written by AI from verified observations — please read before sending." : "Rendered from your template."}><Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[260px] font-[450]" /></Field>
                {data.sendBlocker && <Alert tone="warning" title="Sending is currently blocked">{data.sendBlocker}</Alert>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    {dirty && <Button variant="outline" onClick={async () => { setBusy("save"); try { await save(); toast.success("Draft saved"); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } }} loading={busy === "save"}>Save draft</Button>}
                    <Button variant="ghost" onClick={async () => { await apiFetch(`/api/emails/drafts/${d.id}`, { method: "DELETE" }); setSubject(""); setBody(""); router.refresh(); }}><Trash2 className="h-4 w-4" /> Discard</Button>
                  </div>
                  {perms.send && <Button onClick={review} loading={busy === "review"} disabled={!to || !subject || !body}><Send className="h-4 w-4" /> Review & send</Button>}
                </div>
              </div>
            )}
          </Card>
        )}
        <Card>
          <CardHeader title="Email history" />
          {data.messages.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No emails yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.messages.map((m: any) => (
                <li key={m.id}>
                  <Link href={m.conversationId ? `/inbox/${m.conversationId}` : "#"} className="flex items-start gap-3 px-5 py-3 hover:bg-subtle/60">
                    {m.direction === "OUTBOUND" ? <ArrowUpRight className="mt-0.5 h-4 w-4 text-accent" /> : <ArrowDownLeft className="mt-0.5 h-4 w-4 text-success" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{m.subject}{m.status === "FAILED" && <Badge tone="red">Failed</Badge>}{m.aiGenerated && <Badge tone="violet">AI</Badge>}{m.intent && <Badge tone={INTENT_META[m.intent]?.tone}>{INTENT_META[m.intent]?.label}</Badge>}</div>
                      <div className="text-xs text-muted">{m.direction === "OUTBOUND" ? `To ${m.toAddress}` : `From ${m.fromAddress}`} · <DateTimeText d={m.sentAt ?? m.receivedAt ?? m.createdAt} />{m.error && <span className="text-danger"> · {m.error}</span>}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="h-fit p-5 text-sm">
        <div className="font-semibold">How outreach works</div>
        <ul className="mt-2 space-y-2 text-[13px] text-muted">
          <li>• Emails reference only what the audit actually detected — no generic “your website could be better”.</li>
          <li>• You see recipient, subject, message, business, source and campaign before anything is sent.</li>
          <li>• An unsubscribe line and your physical address are appended (Settings → Compliance).</li>
          <li>• Daily/hourly limits, minimum delays and the do-not-contact list are enforced on every send.</li>
          <li>• Follow-ups are scheduled automatically and stop the moment the business replies.</li>
        </ul>
        <div className="mt-4 text-xs text-faint">Sending from: {data.emailAccount ? `${data.emailAccount.emailAddress} (${data.emailAccount.provider === "SANDBOX" ? "SANDBOX" : data.emailAccount.provider.toLowerCase()})` : <Link href="/settings/email" className="text-accent hover:underline">Connect an email account</Link>}</div>
      </Card>
      <SendConfirmDialog open={Boolean(summary)} summary={summary} onClose={() => setSummary(null)} onConfirm={send} loading={busy === "send"} />
    </div>
  );
}
