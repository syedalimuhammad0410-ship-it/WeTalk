"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, CheckCircle2, Copy, FlaskConical, Hand, Pause, Pencil, Play, RefreshCcw, Send, ShieldOff, Sparkles, X, Mail, Phone, Globe, Lock, Unlock, Link2 } from "lucide-react";
import { Card, Badge, Alert } from "../ui/misc";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/form";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { INTENT_META } from "@/lib/constants";
import { StatusBadge, WebsiteBadge } from "../leads/status-badge";

type Perms = { approve: boolean; send: boolean; compose: boolean; edit: boolean };

export function Conversation({ conv, followUps, leadOptions, perms }: { conv: any; followUps: any[]; leadOptions: { id: string; name: string; city: string | null }[]; perms: Perms }) {
  const router = useRouter();
  const toast = useToast();
  const b = conv.business;
  const sandbox = conv.emailAccount?.provider === "SANDBOX";
  const pending = conv.drafts.find((d: any) => d.status === "PENDING");
  const lastInbound = [...conv.messages].reverse().find((m: any) => m.direction === "INBOUND");
  const [draftBody, setDraftBody] = useState<string>(pending?.body ?? "");
  const [editingDraft, setEditingDraft] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [simulate, setSimulate] = useState(false);
  const [simText, setSimText] = useState("Hi, thanks for reaching out. We're interested. How much do you charge?");
  const [confirmDnc, setConfirmDnc] = useState(false);
  const [linkTo, setLinkTo] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"thread" | "ai" | "business">("thread");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setDraftBody(pending?.body ?? ""), [pending?.id, pending?.body]);
  useEffect(() => {
    if (conv.unread) apiFetch(`/api/conversations/${conv.id}/control`, { body: { action: "MARK_READ" } }).then(() => router.refresh()).catch(() => {});
    bottom.current?.scrollIntoView({ block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  async function run(key: string, fn: () => Promise<any>, ok: string | ((r: any) => string)) {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(typeof ok === "string" ? ok : ok(r));
      router.refresh();
      return r;
    } catch (e) {
      toast.error("Action failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const control = (action: string, ok: string) => run(action, () => apiFetch(`/api/conversations/${conv.id}/control`, { body: { action } }), ok);
  const subjectRe = conv.subject.toLowerCase().startsWith("re:") ? conv.subject : `Re: ${conv.subject}`;

  const businessPanel = (
    <Card className="p-4">
      {b ? (
        <>
          <Link href={`/leads/${b.id}`} className="font-semibold hover:text-accent">{b.name}</Link>
          <div className="mt-0.5 text-xs text-muted">{conv.businessTypeLabel} · {b.city ?? "—"}</div>
          <div className="mt-3 flex flex-wrap gap-1.5"><StatusBadge status={b.status} /><WebsiteBadge websiteClass={b.websiteClass} websiteStatus={b.websiteStatus} /></div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-faint" /><span className="truncate">{conv.counterpartEmail}</span></div>
            {b.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-faint" /><a href={`tel:${b.phone}`}>{b.phone}</a></div>}
            {b.website && <div className="flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-faint" /><a href={b.website} target="_blank" rel="noreferrer noopener" className="truncate text-accent">{b.websiteDomain ?? b.website}</a></div>}
          </dl>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-subtle p-2"><div className="text-base font-semibold tabular-nums">{b.websiteScore ?? "—"}</div>Website</div>
            <div className="rounded-lg bg-subtle p-2"><div className="text-base font-semibold tabular-nums">{b.opportunityScore ?? "—"}</div>Opportunity</div>
            <div className="rounded-lg bg-subtle p-2"><div className="text-base font-semibold tabular-nums">{b.leadScore ?? "—"}</div>Lead</div>
          </div>
          {followUps.length > 0 && <p className="mt-4 text-xs text-muted">{followUps.length} follow-up(s) scheduled — they stop automatically when the business replies.</p>}
          {conv.assignee && <p className="mt-2 text-xs text-muted">Assigned to {conv.assignee}</p>}
        </>
      ) : (
        <div className="space-y-3">
          <Alert tone="warning" title="Unmatched sender">{conv.counterpartEmail} couldn&apos;t be matched to a lead automatically.</Alert>
          {perms.edit && (
            <>
              <Field label="Link to lead" htmlFor="link"><Select id="link" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}><option value="">Choose a lead…</option>{leadOptions.map((l) => <option key={l.id} value={l.id}>{l.name}{l.city ? ` — ${l.city}` : ""}</option>)}</Select></Field>
              <Button size="sm" disabled={!linkTo} loading={busy === "link"} onClick={() => run("link", () => apiFetch(`/api/conversations/${conv.id}/link`, { body: { businessId: linkTo } }), "Linked to lead")}><Link2 className="h-4 w-4" /> Link</Button>
            </>
          )}
        </div>
      )}
    </Card>
  );

  const aiPanel = (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-accent" /> AI intelligence</div>
        {lastInbound ? (
          <dl className="space-y-2.5 text-sm">
            <Row label="Intent">{lastInbound.intent ? <Badge tone={INTENT_META[lastInbound.intent]?.tone}>{INTENT_META[lastInbound.intent]?.label}</Badge> : <span className="text-faint">Analysing…</span>}</Row>
            <Row label="Confidence">{lastInbound.confidence != null ? <span className={cn("font-semibold tabular-nums", lastInbound.confidence >= 85 ? "text-success" : lastInbound.confidence >= 65 ? "text-warning" : "text-danger")}>{lastInbound.confidence}%</span> : "—"}</Row>
            <Row label="Lead score"><span className="font-semibold tabular-nums">{b?.leadScore ?? "—"}/100</span></Row>
            {lastInbound.analysis?.recommended && <Row label="Recommended action"><span>{lastInbound.analysis.recommended}</span></Row>}
            {lastInbound.analysis?.contextResolution && <Row label="Context"><span className="text-muted">{lastInbound.analysis.contextResolution}</span></Row>}
            {lastInbound.analysis?.summary && <Row label="Summary"><span className="text-muted">{lastInbound.analysis.summary}</span></Row>}
            {lastInbound.analysis?.notes?.length > 0 && <p className="text-xs text-faint">{lastInbound.analysis.notes.join(" ")}</p>}
          </dl>
        ) : (
          <p className="text-sm text-muted">No reply from the business yet.</p>
        )}
        {conv.needsHumanReview && <Alert tone="warning" className="mt-4" title="Human review required">{conv.reviewReason}</Alert>}
        {!conv.needsHumanReview && conv.reviewReason && <p className="mt-3 text-xs text-muted">{conv.reviewReason}</p>}
      </Card>
      {pending && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-500" /> AI draft</span><span className="text-xs text-muted">{pending.confidence}% · {timeAgo(pending.createdAt)}</span></div>
          {editingDraft ? <Textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} className="min-h-[220px] text-sm" aria-label="Edit AI draft" /> : <p className="whitespace-pre-wrap rounded-lg bg-subtle p-3 text-sm">{pending.body}</p>}
          {pending.missingInfo?.length > 0 && <p className="mt-2 text-xs text-warning">Missing configured info: {pending.missingInfo.join(", ")}. The draft avoids inventing it.</p>}
          {pending.reviewReasons?.length > 0 && <ul className="mt-2 space-y-0.5 text-[11px] text-muted">{pending.reviewReasons.map((r: string) => <li key={r}>• {r}</li>)}</ul>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {perms.approve && <Button size="sm" loading={busy === "approve"} onClick={() => run("approve", () => apiFetch(`/api/drafts/${pending.id}/approve`, { body: editingDraft ? { body: draftBody } : {} }), (r) => (r?.sandbox ? "Sent (sandbox — not delivered)" : "Response sent"))}><CheckCircle2 className="h-4 w-4" /> Approve & Send</Button>}
            {perms.compose && <Button size="sm" variant="outline" onClick={() => setEditingDraft((v) => !v)}><Pencil className="h-4 w-4" /> {editingDraft ? "Preview" : "Edit"}</Button>}
            {perms.compose && <Button size="sm" variant="outline" loading={busy === "regen"} loadingText="Generating response…" onClick={() => run("regen", () => apiFetch(`/api/conversations/${conv.id}/regenerate`, { body: {} }), "New draft generated")}><RefreshCcw className="h-4 w-4" /> Regenerate</Button>}
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(editingDraft ? draftBody : pending.body); toast.success("Draft copied"); }}><Copy className="h-4 w-4" /> Copy</Button>
            {perms.approve && <Button size="sm" variant="ghost" loading={busy === "reject"} onClick={() => run("reject", () => apiFetch(`/api/drafts/${pending.id}/reject`, { body: {} }), "Draft rejected")}><X className="h-4 w-4" /> Reject</Button>}
          </div>
        </Card>
      )}
      {!pending && lastInbound && perms.compose && !b?.doNotContact && (
        <Button variant="outline" className="w-full" loading={busy === "regen"} loadingText="Generating response…" onClick={() => run("regen", () => apiFetch(`/api/conversations/${conv.id}/regenerate`, { body: {} }), "Analysis refreshed")}><Sparkles className="h-4 w-4" /> Generate AI response</Button>
      )}
      {perms.send && b && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">AI controls</div>
          <div className="grid grid-cols-2 gap-2">
            {b.aiPaused ? <Button size="sm" variant="outline" onClick={() => control("RESUME_AI", "AI resumed")} loading={busy === "RESUME_AI"}><Play className="h-4 w-4" /> Resume AI</Button> : <Button size="sm" variant="outline" onClick={() => control("PAUSE_AI", "AI paused")} loading={busy === "PAUSE_AI"}><Pause className="h-4 w-4" /> Pause AI</Button>}
            {b.humanTakeover ? <Button size="sm" variant="outline" onClick={() => control("RELEASE", "Released to AI")} loading={busy === "RELEASE"}><Bot className="h-4 w-4" /> Release</Button> : <Button size="sm" variant="outline" onClick={() => control("TAKE_OVER", "You've taken over")} loading={busy === "TAKE_OVER"}><Hand className="h-4 w-4" /> Take Over</Button>}
            {!b.doNotContact && <Button size="sm" variant="outline" className="col-span-2 text-danger" onClick={() => setConfirmDnc(true)}><ShieldOff className="h-4 w-4" /> Do Not Contact</Button>}
          </div>
          <p className="mt-2 text-[11px] text-faint">{b.aiPaused ? "AI is paused: no drafts or automatic replies." : b.humanTakeover ? "A human owns this conversation: no automatic replies." : "AI drafts replies; sending follows your workspace response mode."}</p>
        </Card>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/inbox" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Inbox</Link>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{conv.subject}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {sandbox && perms.send && <Button variant="outline" size="sm" onClick={() => setSimulate(true)}><FlaskConical className="h-4 w-4" /> Simulate reply</Button>}
          {perms.send && (conv.isOpen ? <Button size="sm" variant="ghost" onClick={() => control("CLOSE", "Conversation closed")}><Lock className="h-4 w-4" /> Close</Button> : <Button size="sm" variant="ghost" onClick={() => control("REOPEN", "Conversation reopened")}><Unlock className="h-4 w-4" /> Reopen</Button>)}
        </div>
      </div>
      {b?.doNotContact && <Alert tone="danger" title="Do Not Contact">This business asked not to be contacted (or was marked so). Outreach, follow-ups and AI replies are blocked.</Alert>}
      <div className="flex rounded-lg border border-border bg-surface p-0.5 lg:hidden" role="tablist">
        {(["thread", "ai", "business"] as const).map((p) => <button key={p} role="tab" aria-selected={mobilePanel === p} onClick={() => setMobilePanel(p)} className={cn("flex-1 rounded-md py-1.5 text-sm", mobilePanel === p ? "bg-subtle font-medium" : "text-muted")}>{{ thread: "Conversation", ai: "AI", business: "Business" }[p]}</button>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside className={cn("lg:block", mobilePanel === "business" ? "block" : "hidden")}>{businessPanel}</aside>
        <section className={cn("min-w-0 lg:block", mobilePanel === "thread" ? "block" : "hidden")}>
          <Card className="flex flex-col">
            <ol className="max-h-[62vh] space-y-4 overflow-y-auto p-4 sm:p-5">
              {conv.messages.map((m: any) => (
                <li key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[92%] rounded-2xl border px-4 py-3 sm:max-w-[80%]", m.direction === "OUTBOUND" ? "border-accent/20 bg-accent/[0.06]" : "border-border bg-surface")}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="font-medium text-fg">{m.direction === "OUTBOUND" ? "You" : (b?.name ?? m.fromAddress)}</span>
                      <span title={formatDateTime(m.sentAt ?? m.receivedAt ?? m.createdAt)}>{formatDateTime(m.sentAt ?? m.receivedAt ?? m.createdAt)}</span>
                      {m.aiGenerated && <Badge tone="violet">AI-drafted</Badge>}
                      {m.kind === "FOLLOW_UP" && <Badge tone="orange">Follow-up</Badge>}
                      {m.status === "FAILED" && <Badge tone="red">Failed</Badge>}
                      {m.intent && <Badge tone={INTENT_META[m.intent]?.tone}>{INTENT_META[m.intent]?.label}</Badge>}
                      {m.analysis?.matchedBy && m.direction === "INBOUND" && <span className="text-[10px] text-faint">matched by {String(m.analysis.matchedBy).replace(/_/g, " ")}</span>}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.bodyText}</p>
                    {m.error && <p className="mt-1 text-xs text-danger">{m.error}</p>}
                  </div>
                </li>
              ))}
              <div ref={bottom} />
            </ol>
            {perms.send && !b?.doNotContact && (
              <form className="border-t border-border p-3 sm:p-4" onSubmit={async (e) => { e.preventDefault(); const r = await run("reply", () => apiFetch(`/api/conversations/${conv.id}/reply`, { body: { subject: subjectRe, body: reply } }), (x) => (x?.sandbox ? "Sent (sandbox — not delivered)" : "Reply sent")); if (r) setReply(""); }}>
                <label htmlFor="reply" className="sr-only">Write a reply</label>
                <Textarea id="reply" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply yourself…" className="min-h-[90px]" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-faint">Sends from {conv.emailAccount?.emailAddress ?? "your default account"}{sandbox && " (SANDBOX)"}</span>
                  <Button type="submit" size="sm" loading={busy === "reply"} disabled={!reply.trim()}><Send className="h-4 w-4" /> Send reply</Button>
                </div>
              </form>
            )}
          </Card>
        </section>
        <aside className={cn("lg:block", mobilePanel === "ai" ? "block" : "hidden")}>{aiPanel}</aside>
      </div>
      <Dialog open={simulate} onClose={() => setSimulate(false)} title="Simulate a reply (SANDBOX)" description="Pretend the business replied. The full pipeline runs: matching, classification, do-not-contact rules, AI draft and safety checks."
        footer={<><Button variant="outline" onClick={() => setSimulate(false)}>Cancel</Button><Button loading={busy === "sim"} onClick={async () => { await run("sim", () => apiFetch(`/api/conversations/${conv.id}/simulate`, { body: { body: simText } }), "Reply received — analysing in the background"); setSimulate(false); setTimeout(() => router.refresh(), 2500); }}>Simulate reply</Button></>}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {["Hi, thanks for reaching out. We're interested. How much do you charge?", "Sounds good. Tuesday works.", "Please don't contact us again.", "We already have someone handling our website, thanks.", "How did you get my email? This is spam and I'm reporting it."].map((t) => <button key={t} onClick={() => setSimText(t)} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-subtle">{t.slice(0, 32)}…</button>)}
          </div>
          <Field label="Reply text" htmlFor="sim"><Textarea id="sim" value={simText} onChange={(e) => setSimText(e.target.value)} /></Field>
          <Field label="From" htmlFor="simfrom"><Input id="simfrom" value={conv.counterpartEmail} readOnly /></Field>
        </div>
      </Dialog>
      <ConfirmDialog open={confirmDnc} onClose={() => setConfirmDnc(false)} title="Mark as Do Not Contact?" confirmLabel="Mark Do Not Contact" loading={busy === "DO_NOT_CONTACT"} onConfirm={async () => { await control("DO_NOT_CONTACT", "Marked Do Not Contact"); setConfirmDnc(false); }} description="Stops new outreach, automated follow-ups and automatic replies for this business until an admin explicitly reverses it." />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
