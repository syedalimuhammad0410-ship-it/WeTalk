"use client";
import { useEffect, useState } from "react";
import { Copy, FileText, Phone, Sparkles } from "lucide-react";
import { Alert, Card, CardHeader } from "../ui/misc";
import { Button } from "../ui/button";
import { Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import type { LeadData, LeadPerms } from "./types";

type Script = {
  phone: string | null; opener: string; observations: string[]; noAudit: boolean; questions: string[]; offer: string;
  objections: { q: string; a: string }[]; close: string; askForEmail: boolean;
};
type Quote = { text: string; issues: string[]; packageName: string; price: string };

/** Phone pitch built from the audit, and a quote built from the agency's own pricing. */
export function PitchTab({ data, perms }: { data: LeadData; perms: LeadPerms }) {
  const toast = useToast();
  const b = data.business;
  const [script, setScript] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);

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
    </div>
  );
}
