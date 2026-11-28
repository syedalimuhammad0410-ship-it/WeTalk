"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Bot, Clock, Mail, MailCheck, Search, Send, ShieldCheck } from "lucide-react";
import { Button, ButtonLink } from "../ui/button";
import { Alert, Badge, Card, EmptyState, PageHeader } from "../ui/misc";
import { Checkbox, Input, Select, Switch } from "../ui/form";
import { Tabs } from "../ui/tabs";
import { RepliesView, type ReplyRow } from "./replies";
import { RelTime } from "../ui/time";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";

export type AudienceLead = {
  id: string; name: string; category: string | null; group: string; city: string | null; website: string | null; email: string;
  eligibility: "ELIGIBLE" | "NEEDS_REVIEW" | "INELIGIBLE"; reason: string | null; emailed: boolean; lastContactedAt: string | null; doNotContact: boolean; suppressed: boolean;
};
type Notice = { code: string; title: string; detail: string; href: string };
type Setup = { blockers: Notice[]; warnings?: Notice[]; sender: string | null; senders?: { email: string; sent: number; cap: number; resting: boolean }[]; roomToday?: number | null; writer: string | null; limits: { perDay: number; perHour: number; gapMinutes: number } };
type RunRow = { id: string; name: string; status: string; total: number; sent: number; skipped: number; failed: number; createdAt: string; finishedAt: string | null };
export type ComposerData = { leads: AudienceLead[]; setup: Setup; runs: RunRow[]; groups: { id: string; label: string }[]; replies: ReplyRow[] };

type Show = "ready" | "review" | "emailed" | "all";
const SHOW: { id: Show; label: string }[] = [
  { id: "ready", label: "Ready to email" },
  { id: "review", label: "Needs review" },
  { id: "emailed", label: "Already emailed" },
  { id: "all", label: "All" },
];

export function leadState(l: AudienceLead): { key: "ready" | "review" | "emailed" | "blocked"; label: string; tone: "emerald" | "amber" | "sky" | "zinc" | "red" } {
  if (l.doNotContact || l.suppressed) return { key: "blocked", label: "Do not contact", tone: "red" };
  if (l.emailed) return { key: "emailed", label: "Already emailed", tone: "sky" };
  if (l.eligibility === "INELIGIBLE") return { key: "blocked", label: "Not allowed (CASL)", tone: "zinc" };
  if (l.eligibility === "NEEDS_REVIEW") return { key: "review", label: "Needs review", tone: "amber" };
  return { key: "ready", label: "Ready", tone: "emerald" };
}

export const RUN_STATUS: Record<string, { label: string; tone: "emerald" | "sky" | "amber" | "zinc" | "slate" | "indigo" }> = {
  QUEUED: { label: "Starting", tone: "indigo" },
  RUNNING: { label: "Sending live", tone: "emerald" },
  PAUSED: { label: "Paused", tone: "amber" },
  COMPLETED: { label: "Done", tone: "sky" },
  CANCELLED: { label: "Cancelled", tone: "zinc" },
};

export function EmailsComposer({ initial, canSend, initialTab = "send" }: { initial: ComposerData; canSend: boolean; initialTab?: "send" | "replies" }) {
  const router = useRouter();
  const toast = useToast();
  const { leads, setup, runs, groups, replies } = initial;
  const [tab, setTab] = useState<"send" | "replies">(initialTab);
  const switchTab = (t: "send" | "replies") => {
    setTab(t);
    window.history.replaceState(null, "", t === "replies" ? "/emails?tab=replies" : "/emails");
  };
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [city, setCity] = useState<string>("all");
  const [show, setShow] = useState<Show>("ready");
  const [includeReview, setIncludeReview] = useState(false);
  const [useAi, setUseAi] = useState(Boolean(setup.writer));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [howMany, setHowMany] = useState("");

  const open = runs.find((r) => ["QUEUED", "RUNNING", "PAUSED"].includes(r.status));
  const blocked = setup.blockers.length > 0;
  const selectable = (l: AudienceLead) => {
    const s = leadState(l).key;
    return s === "ready" || (s === "review" && includeReview);
  };

  const cities = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) if (l.city) m.set(l.city, (m.get(l.city) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (city !== "all" && (l.city ?? "") !== city) return false;
      if (needle && !`${l.name} ${l.email} ${l.category ?? ""} ${l.city ?? ""}`.toLowerCase().includes(needle)) return false;
      const s = leadState(l).key;
      if (show === "ready" && s !== "ready") return false;
      if (show === "review" && s !== "review") return false;
      if (show === "emailed" && s !== "emailed") return false;
      return true;
    });
  }, [leads, q, city, show]);
  const groupCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of base) m.set(l.group, (m.get(l.group) ?? 0) + 1);
    return m;
  }, [base]);
  const visible = group === "all" ? base : base.filter((l) => l.group === group);
  const visibleSelectable = visible.filter(selectable);
  const allVisiblePicked = visibleSelectable.length > 0 && visibleSelectable.every((l) => picked.has(l.id));
  const readyCount = leads.filter((l) => leadState(l).key === "ready").length;

  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const toggleVisible = (on: boolean) => setPicked((s) => { const n = new Set(s); for (const l of visibleSelectable) if (on) n.add(l.id); else n.delete(l.id); return n; });
  const pickAllReady = () => setPicked(new Set(leads.filter((l) => leadState(l).key === "ready").map((l) => l.id)));

  const start = async () => {
    const ids = [...picked].filter((id) => { const l = leads.find((x) => x.id === id); return l && selectable(l); });
    if (!ids.length) return;
    setBusy(true);
    try {
      const label = group !== "all" ? groups.find((g) => g.id === group)?.label : city !== "all" ? city : null;
      const r = await apiFetch<{ run: { id: string; total: number }; excluded: Record<string, number> }>("/api/emails/runs", {
        body: { businessIds: ids, useAi, includeNeedsReview: includeReview, name: `${label ? `${label} · ` : ""}${ids.length} ${ids.length === 1 ? "business" : "businesses"}`, filters: { group, city, q, show } },
      });
      const skipped = Object.values(r.excluded).reduce((a, b) => a + b, 0);
      if (skipped) toast.success(`${skipped} left out`, "Already emailed, not cleared under CASL, or a duplicate address.");
      router.push(`/emails/runs/${r.run.id}`);
    } catch (e) {
      toast.error("Couldn't start", (e as Error).message);
      setBusy(false);
    }
  };

  const selectedCount = [...picked].filter((id) => { const l = leads.find((x) => x.id === id); return l && selectable(l); }).length;
  const limitText = [setup.limits.perDay > 0 && `${setup.limits.perDay}/day`, setup.limits.perHour > 0 && `${setup.limits.perHour}/hour`, setup.limits.gapMinutes > 0 && `${setup.limits.gapMinutes} min apart`].filter(Boolean).join(" · ");
  /** "How many?" — typing a number selects the first N businesses that can be emailed in the current filter. */
  const pickFirst = (raw: string) => {
    setHowMany(raw);
    const n = Math.min(parseInt(raw, 10), visibleSelectable.length);
    if (n > 0) setPicked(new Set(visibleSelectable.slice(0, n).map((l) => l.id)));
  };

  return (
    <div className="pb-28">
      <PageHeader
        title="Emails"
        description="Email your leads in one go. Filter by type or city, pick specific businesses or all of them, then watch each email get written and sent."
        actions={tab === "send" && readyCount > 0 && canSend ? <Button variant="outline" onClick={pickAllReady}><MailCheck className="h-4 w-4" /> Select all {readyCount} ready</Button> : null}
      />
      <Tabs className="mb-5" value={tab} onChange={switchTab} tabs={[{ id: "send", label: "Send emails" }, { id: "replies", label: "Replies", count: replies.length }]} />
      {tab === "replies" ? <RepliesView replies={replies} /> : (<>

      {[...setup.blockers, ...(setup.warnings ?? [])].map((b) => (
        <Alert key={`${b.code}:${b.title}`} tone="warning" className="mb-3" title={b.title} action={<ButtonLink href={b.href} size="sm" variant="outline">Fix this <ArrowRight className="h-3.5 w-3.5" /></ButtonLink>}>
          {b.detail}
        </Alert>
      ))}

      {open && (
        <Alert tone="info" className="mb-3" title={`“${open.name}” is ${RUN_STATUS[open.status]?.label.toLowerCase() ?? open.status.toLowerCase()}`} action={<ButtonLink href={`/emails/runs/${open.id}`} size="sm">Watch it <ArrowRight className="h-3.5 w-3.5" /></ButtonLink>}>
          {open.sent} of {open.total} emailed so far. One run at a time keeps your sending limits safe.
        </Alert>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3 p-4"><Mail className="h-5 w-5 text-accent" /><div className="min-w-0"><div className="text-xs text-muted">Sends from</div><div className="truncate text-sm font-medium" title={setup.senders?.map((x) => `${x.email}: ${x.sent}${x.cap ? ` of ${x.cap}` : ""} sent in 24 h`).join("\n")}>{setup.sender ?? "No email account connected"}</div>{(setup.senders?.length ?? 0) > 0 && <div className="text-xs text-muted">{setup.roomToday == null ? "No daily cap" : `Room for ${setup.roomToday} more today`} · <Link href="/settings/email" className="underline hover:text-fg">Inboxes</Link></div>}</div></Card>
        <Card className="flex items-center gap-3 p-4"><Bot className="h-5 w-5 text-accent" /><div className="min-w-0"><div className="text-xs text-muted">Each email is written by</div><div className="truncate text-sm font-medium">{setup.writer ?? "Your template (no AI connected)"}</div></div></Card>
        {limitText ? (
          <Card className="flex items-center gap-3 p-4"><Clock className="h-5 w-5 text-accent" /><div className="min-w-0"><div className="text-xs text-muted">Your sending limits</div><div className="text-sm font-medium">{limitText}</div><Link href="/settings/compliance" className="text-xs text-muted underline hover:text-fg">Change (0 = no limit)</Link></div></Card>
        ) : (
          <Card className="flex items-start gap-3 border-amber-400/60 bg-amber-50 p-4 dark:bg-amber-500/10">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0"><div className="text-sm font-semibold text-amber-900 dark:text-amber-200">Caution: no sending limit</div><div className="text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">Sending lots of cold emails at once from a personal Gmail can land them in spam or get the account paused by Google.</div></div>
          </Card>
        )}
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a business, email or city…" className="pl-9" aria-label="Search leads" />
          </div>
          <Select value={city} onChange={(e) => setCity(e.target.value)} className="lg:w-56" aria-label="City">
            <option value="all">All cities</option>
            {cities.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
          </Select>
          <div className="flex flex-wrap gap-1 rounded-lg bg-subtle p-1" role="tablist" aria-label="Which leads">
            {SHOW.map((s) => (
              <button key={s.id} role="tab" aria-selected={show === s.id} onClick={() => setShow(s.id)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", show === s.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[{ id: "all", label: "All types" }, ...groups, { id: "other", label: "Other" }].map((g) => {
            const n = g.id === "all" ? base.length : groupCount.get(g.id) ?? 0;
            if (g.id !== "all" && !n) return null;
            return (
              <button key={g.id} onClick={() => setGroup(g.id)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", group === g.id ? "border-accent bg-accent text-white" : "border-border bg-surface text-muted hover:border-faint hover:text-fg")}>
                {g.label} <span className={cn("ml-1 tabular-nums", group === g.id ? "text-white/80" : "text-faint")}>{n}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} title="No leads match" description={show === "ready" ? "Nobody here is ready to email. Try “Needs review” or “All”, or find more leads with emails first." : "Try a different filter."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-subtle/60 text-left text-xs text-muted">
                <tr>
                  <th className="w-10 px-4 py-2.5"><Checkbox checked={allVisiblePicked} indeterminate={!allVisiblePicked && visibleSelectable.some((l) => picked.has(l.id))} onChange={toggleVisible} disabled={!visibleSelectable.length || !canSend} aria-label="Select all shown" /></th>
                  <th className="px-2 py-2.5 font-medium">Business</th>
                  <th className="px-2 py-2.5 font-medium">City</th>
                  <th className="px-2 py-2.5 font-medium">Email</th>
                  <th className="px-2 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => {
                  const st = leadState(l);
                  const can = selectable(l) && canSend;
                  return (
                    <tr key={l.id} className={cn("border-b border-border/60 last:border-0", can ? "cursor-pointer hover:bg-subtle/50" : "opacity-70")} onClick={() => can && toggle(l.id, !picked.has(l.id))}>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}><Checkbox checked={picked.has(l.id) && can} onChange={(v) => toggle(l.id, v)} disabled={!can} aria-label={`Select ${l.name}`} /></td>
                      <td className="max-w-[260px] px-2 py-2.5"><Link href={`/leads/${l.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline">{l.name}</Link><div className="truncate text-xs text-muted">{l.category ?? "Business"}</div></td>
                      <td className="px-2 py-2.5 text-muted">{l.city ?? "—"}</td>
                      <td className="max-w-[240px] truncate px-2 py-2.5 font-mono text-xs">{l.email}</td>
                      <td className="px-2 py-2.5"><span title={l.reason ?? undefined}><Badge tone={st.tone} dot>{st.label}</Badge></span>{l.emailed && l.lastContactedAt && <div className="mt-0.5 text-[11px] text-faint"><RelTime d={l.lastContactedAt} /></div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {runs.length > 0 && (
        <Card className="mt-4 p-4">
          <div className="mb-2 text-sm font-semibold">Recent email runs</div>
          <div className="divide-y divide-border">
            {runs.map((r) => (
              <Link key={r.id} href={`/emails/runs/${r.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-accent">
                <span className="truncate">{r.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted"><span className="tabular-nums">{r.sent}/{r.total} emailed</span><Badge tone={RUN_STATUS[r.status]?.tone ?? "slate"}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge><RelTime d={r.createdAt} /></span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      </>)}

      {canSend && tab === "send" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <label htmlFor="how-many" className="text-sm font-medium">How many?</label>
                <Input id="how-many" type="number" inputMode="numeric" min={1} max={visibleSelectable.length || undefined} value={howMany} onChange={(e) => pickFirst(e.target.value)} placeholder={String(visibleSelectable.length)} className="h-8 w-20" aria-describedby="how-many-hint" />
                <span id="how-many-hint" className="text-xs text-muted">of {visibleSelectable.length} shown</span>
              </div>
              <div className="text-sm"><span className="font-semibold tabular-nums">{selectedCount}</span> selected{picked.size > 0 && <button className="ml-2 text-xs text-muted underline" onClick={() => { setPicked(new Set()); setHowMany(""); }}>clear</button>}</div>
              <Switch checked={useAi} onChange={setUseAi} disabled={!setup.writer} label="Write each email with AI" description={setup.writer ? setup.writer : "Connect an AI key in Settings to turn this on"} />
              <Switch checked={includeReview} onChange={(v) => { setIncludeReview(v); if (v) setShow("all"); }} label={<span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Include “needs review”</span>} description="Only if you have consent to email these addresses" />
            </div>
            <div className="flex items-center gap-3">
            {selectedCount > 40 && <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Big batch — may land in spam</span>}
            <Button onClick={start} loading={busy} loadingText="Starting…" disabled={!selectedCount || blocked || Boolean(open)} title={blocked ? setup.blockers.map((b) => b.title).join(" · ") : open ? "Another run is still open" : undefined}>
              <Send className="h-4 w-4" /> Email {selectedCount || ""} {selectedCount === 1 ? "business" : "businesses"}
            </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
