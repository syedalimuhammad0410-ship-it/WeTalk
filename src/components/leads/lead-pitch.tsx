"use client";
import { useEffect, useState } from "react";
import { Copy, FileText, Mail, Phone, Send, Sparkles } from "lucide-react";
import { Alert, Badge, Card, CardHeader } from "../ui/misc";
import { ConfirmDialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input, Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import type { LeadData, LeadPerms } from "./types";

type Script = {
  phone: string | null; opener: string; observations: string[]; noAudit: boolean; questions: string[]; offer: string;
  objections: { q: string; a: string }[]; close: string; askForEmail: boolean;
};
type Quote = { text: string; issues: string[]; packageName: string; price: string };
type QuoteEmail = { draftId: string; to: string | null; subject: string; body: string; issues: string[]; sendBlocker: string | null; options: { level: string; name: string; price: string }[] };
type SendSummary = { recipient: string; subject: string; from: string; sandbox: boolean };

/** Phone pitch built from the audit, and a quote built from the agency's own pricing. */
export function PitchTab({ data, perms }: { data: LeadData; perms: LeadPerms }) {
  const toast = useToast();
  const b = data.business;
  const [script, setScript] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState<QuoteEmail | null>(null);
  const [mailBusy, setMailBusy] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState<SendSummary | null>(null);

  useEffect(() => {
    if (!perms.compose) return;
    apiFetch<Script>(`/api/leads/${b.id}/pitch`, { method: "GET" }).then(setScript, (e) => setError((e as Error).message));
  }, [b.id, perms.compose]);

  async function buildQuote() {
    setBusy(true);
    try {
      setQuote(await apiFetch<Quote>(`/api/leads/${b.id}/pitch`, { body: { requirements } }));
    } catch (e) {
      toast.error("Quote not built", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function writeQuoteEmail() {
    setMailBusy("write");
    try {
      setMail(await apiFetch<QuoteEmail>(`/api/leads/${b.id}/quote-email`, { body: { requirements } }));
    } catch (e) {
      toast.error("Quote email not written", (e as Error).message);
    } finally {
      setMailBusy(null);
    }
  }
  async function saveMail() {
    if (!mail) return;
    await apiFetch(`/api/emails/drafts/${mail.draftId}`, { method: "PATCH", body: { subject: mail.subject, body: mail.body, to: mail.to ?? "" } });
  }
  async function prepareSend() {
    setMailBusy("send");
    try {
      await saveMail();
      const r = await apiFetch<{ summary: SendSummary }>("/api/emails/send", { body: { draftId: mail!.draftId, dryRun: true } });
      setConfirmSend(r.summary);
    } catch (e) {
      toast.error("Can't send yet", (e as Error).message);
    } finally {
      setMailBusy(null);
    }
  }
  async function send() {
    setMailBusy("confirm");
    try {
      const r = await apiFetch<{ sent?: boolean; sandbox?: boolean }>("/api/emails/send", { body: { draftId: mail!.draftId, confirmed: true } });
      toast.success(r.sandbox ? "Sent (sandbox — no real email left)" : "Quote sent from your email", `To ${confirmSend?.recipient}`);
      setConfirmSend(null);
      setMail(null);
    } catch (e) {
      toast.error("Not sent", (e as Error).message);
    } finally {
      setMailBusy(null);
    }
  }
  const copy = (text: string, what: string) => { navigator.clipboard.writeText(text); toast.success(`${what} copied`); };

  if (!perms.compose) return <Card className="p-5 text-sm text-muted">Your role can&apos;t prepare outreach for this lead.</Card>;
  const scriptText = script ? [script.opener, "", ...script.observations.map((o) => `• ${o}`), "", "Questions:", ...script.questions.map((q) => `• ${q}`), "", script.offer, "", script.close].join("\n") : "";

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Phone className="h-4 w-4 text-accent" /> Call script</span>} description={script?.phone ? <a href={`tel:${script.phone.replace(/[^\d+]/g, "")}`} className="text-accent hover:underline">Call {script.phone}</a> : "No phone number on file"}
          action={script && <Button size="sm" variant="ghost" onClick={() => copy(scriptText, "Call script")}><Copy className="h-4 w-4" /> Copy</Button>} />
        <div className="space-y-4 px-5 py-4 text-sm">
          {error && <Alert tone="danger" title={error} />}
          {!script && !error && <p className="text-muted">Preparing…</p>}
          {script && <>
            <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Opener</h4><p>{script.opener}</p></section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">What you noticed</h4>
              {script.observations.length ? <ul className="list-disc space-y-1 pl-5">{script.observations.map((o) => <li key={o}>{o}</li>)}</ul> : <p className="text-muted">{script.noAudit ? "Run the website analysis first to get specific talking points." : "No specific issues found — focus on the questions."}</p>}
            </section>
            <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Ask</h4><ul className="list-disc space-y-1 pl-5">{script.questions.map((q) => <li key={q}>{q}</li>)}</ul></section>
            <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Offer</h4><p>{script.offer}</p></section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">If they say…</h4>
              <dl className="space-y-2">{script.objections.map((o) => <div key={o.q}><dt className="font-medium">{o.q}</dt><dd className="text-muted">{o.a}</dd></div>)}</dl>
            </section>
            <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Close</h4><p>{script.close}</p>{script.askForEmail && <p className="mt-1 text-xs text-warning">No email on file — ask for one and add it to the lead.</p>}</section>
          </>}
        </div>
      </Card>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-accent" /> Quote</span>} description="Built from your pricing and what this business needs — never per page." />
        <div className="space-y-3 px-5 py-4">
          <Textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="What did they ask for? e.g. online booking, show their menu, photo gallery, they want to update it themselves…" className="min-h-[90px] text-sm" aria-label="Client requirements" />
          <Button onClick={buildQuote} loading={busy} loadingText="Building quote…"><Sparkles className="h-4 w-4" /> {quote ? "Rebuild quote" : "Build quote"}</Button>
          {quote && <>
            {quote.issues.length > 0 && <Alert tone="warning" title="Check before sending">{quote.issues.join(" ")}</Alert>}
            <pre className="whitespace-pre-wrap rounded-lg bg-subtle p-3 font-sans text-sm">{quote.text}</pre>
            <Button size="sm" variant="outline" onClick={() => copy(quote.text, "Quote")}><Copy className="h-4 w-4" /> Copy quote</Button>
          </>}
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-accent" /> Email a detailed quote</span>} description="Basic, Professional and Premium options from your own price list, written for this business. You review it — nothing is sent until you confirm." />
        <div className="space-y-4 px-5 py-4">
          {!mail ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={writeQuoteEmail} loading={mailBusy === "write"} loadingText="Writing the quote email…"><Sparkles className="h-4 w-4" /> Write detailed quote email</Button>
              <span className="text-xs text-muted">Uses the requirements above (optional) and the website audit.</span>
            </div>
          ) : (
            <>
              {mail.options.length > 0 && <div className="flex flex-wrap gap-2">{mail.options.map((o) => <Badge key={o.level + o.name} tone={o.level === "Professional" ? "violet" : "slate"}>{o.level}: {o.name} — {o.price}</Badge>)}</div>}
              {mail.issues.length > 0 && <Alert tone="warning" title="Check these prices before sending">{mail.issues.join(" ")}</Alert>}
              {mail.sendBlocker && <Alert tone="warning" title="Can't be sent yet">{mail.sendBlocker}</Alert>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="To" htmlFor="qe-to"><Input id="qe-to" type="email" value={mail.to ?? ""} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="business@example.com" /></Field>
                <Field label="Subject" htmlFor="qe-subject"><Input id="qe-subject" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></Field>
              </div>
              <Field label="Message" htmlFor="qe-body" hint="Your signature, mailing address and an unsubscribe link are added automatically when sent."><Textarea id="qe-body" rows={18} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} className="font-mono text-[13px]" /></Field>
              <div className="flex flex-wrap gap-2">
                {perms.send && <Button onClick={prepareSend} loading={mailBusy === "send"} disabled={!mail.to}><Send className="h-4 w-4" /> Send from my email…</Button>}
                <Button variant="outline" onClick={async () => { setMailBusy("save"); try { await saveMail(); toast.success("Draft saved", "Find it in Outreach or the Emails tab."); } catch (e) { toast.error("Not saved", (e as Error).message); } finally { setMailBusy(null); } }} loading={mailBusy === "save"}>Save draft</Button>
                <Button variant="ghost" onClick={writeQuoteEmail} loading={mailBusy === "write"}>Rewrite</Button>
              </div>
            </>
          )}
        </div>
      </Card>
      <ConfirmDialog open={Boolean(confirmSend)} onClose={() => setConfirmSend(null)} tone="primary" title="Send this quote now?" confirmLabel="Send email" loading={mailBusy === "confirm"} onConfirm={send}
        description={confirmSend ? <>From <b>{confirmSend.from}</b> to <b>{confirmSend.recipient}</b>: “{confirmSend.subject}”.{confirmSend.sandbox ? " (Sandbox account — no real email is sent.)" : ""}</> : null} />
    </div>
  );
}
