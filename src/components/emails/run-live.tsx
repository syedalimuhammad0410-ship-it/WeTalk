"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, CircleStop, Clock, Loader2, Mail, Pause, PenLine, Play, Send, SkipForward, X } from "lucide-react";
import { Button } from "../ui/button";
import { Alert, Badge, Card } from "../ui/misc";
import { ConfirmDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";
import { RUN_STATUS } from "./composer";

type Biz = { id: string; name: string; category: string | null; city: string | null; website?: string | null; phone?: string | null };
type LightItem = { id: string; position: number; status: string; email: string; subject: string | null; error: string | null; writer: string | null; finishedAt: string | null; business: Biz; replied?: string | null };
type FullItem = LightItem & { prompt: string | null; body: string | null; startedAt: string | null };
export type RunState = {
  run: { id: string; name: string; status: string; total: number; sent: number; skipped: number; failed: number; left: number; replied?: number; message: string | null; nextSendAt: string | null; writer: string | null; instructions: string | null; useAi: boolean; createdAt: string; startedAt: string | null; finishedAt: string | null };
  items: LightItem[];
  current: FullItem | null;
  selected: FullItem | null;
  setup: { blockers: { code: string; title: string; detail: string; href: string }[]; sender: string | null; writer: string | null; limits: { perDay: number; perHour: number; gapMinutes: number } };
};

const ITEM: Record<string, { label: string; tone: "zinc" | "sky" | "indigo" | "emerald" | "amber" | "red"; icon: React.ReactNode }> = {
  PENDING: { label: "Waiting", tone: "zinc", icon: <span className="h-2 w-2 rounded-full border border-current" /> },
  WRITING: { label: "Writing…", tone: "sky", icon: <PenLine className="h-3.5 w-3.5 animate-pulse" /> },
  SENDING: { label: "Sending…", tone: "indigo", icon: <Send className="h-3.5 w-3.5 animate-pulse" /> },
  SENT: { label: "Emailed", tone: "emerald", icon: <Check className="h-3.5 w-3.5" /> },
  SKIPPED: { label: "Skipped", tone: "amber", icon: <SkipForward className="h-3.5 w-3.5" /> },
  FAILED: { label: "Failed", tone: "red", icon: <X className="h-3.5 w-3.5" /> },
};
type ListTab = "all" | "left" | "emailed" | "problems";
const TONE_CLS = { zinc: "text-zinc-400", sky: "bg-sky-500/10 text-sky-600", indigo: "bg-indigo-500/10 text-indigo-600", emerald: "bg-emerald-500/10 text-emerald-600", amber: "bg-amber-500/10 text-amber-600", red: "bg-red-500/10 text-red-600" } as const;

function useCountdown(to: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  if (!to) return null;
  const s = Math.max(0, Math.round((new Date(to).getTime() - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Reveals text like it's being typed whenever `key` changes (an email just written). */
function useTypewriter(text: string, key: string, animate: boolean) {
  const [shown, setShown] = useState(animate ? "" : text);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!animate || last.current === key) {
      setShown(text);
      return;
    }
    last.current = key;
    let i = 0;
    let raf = 0;
    const step = () => {
      i = Math.min(text.length, i + Math.max(2, Math.ceil(text.length / 90)));
      setShown(text.slice(0, i));
      if (i < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, key, animate]);
  return shown;
}

export function EmailRunLive({ initial, canControl }: { initial: RunState; canControl: boolean }) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ListTab>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const live = ["QUEUED", "RUNNING"].includes(s.run.status);
  const countdown = useCountdown(live ? s.run.nextSendAt : null);
  const sel = useRef(selectedId);
  sel.current = selectedId;
  const stateRef = useRef(s);
  stateRef.current = s;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const next = await apiFetch<RunState>(`/api/emails/runs/${initial.run.id}${sel.current ? `?item=${sel.current}` : ""}`);
          if (alive) setS(next);
        } catch {
          /* keep the last good state */
        }
      }
      if (alive) timer = setTimeout(tick, ["QUEUED", "RUNNING"].includes(stateRef.current.run.status) ? 2000 : 8000);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [initial.run.id]);

  const pick = async (id: string | null) => {
    setSelectedId(id);
    if (!id) return;
    try {
      setS(await apiFetch<RunState>(`/api/emails/runs/${s.run.id}?item=${id}`));
    } catch {
      /* ignore */
    }
  };

  const control = async (action: "pause" | "resume" | "cancel") => {
    setBusy(action);
    try {
      setS(await apiFetch<RunState>(`/api/emails/runs/${s.run.id}`, { method: "PATCH", body: { action } }));
      toast.success(action === "pause" ? "Paused — nothing more is sent until you resume" : action === "resume" ? "Resumed" : "Run cancelled");
    } catch (e) {
      toast.error("Not changed", (e as Error).message);
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };

  const viewing = (selectedId && (s.selected?.id === selectedId ? s.selected : s.current?.id === selectedId ? s.current : null)) || s.current;
  const isLiveItem = Boolean(viewing && !selectedId && ["WRITING", "SENDING"].includes(viewing.status));
  const body = useTypewriter(viewing?.body ?? "", `${viewing?.id}:${viewing?.subject ?? ""}`, Boolean(viewing && !selectedId && live));
  const done = s.run.sent + s.run.skipped + s.run.failed;
  const pct = s.run.total ? Math.round((done / s.run.total) * 100) : 0;
  const nextUp = s.items.find((i) => i.status === "PENDING");
  const st = RUN_STATUS[s.run.status] ?? { label: s.run.status, tone: "slate" as const };
  const list = s.items.filter((i) => (tab === "all" ? true : tab === "left" ? ["PENDING", "WRITING", "SENDING"].includes(i.status) : tab === "emailed" ? i.status === "SENT" : ["SKIPPED", "FAILED"].includes(i.status)));
  const waiting = live && countdown && s.run.nextSendAt && new Date(s.run.nextSendAt).getTime() > Date.now() && !s.items.some((i) => ["WRITING", "SENDING"].includes(i.status));

  const headline = (() => {
    if (!viewing) return live ? "Getting ready…" : "No emails yet";
    const n = viewing.business.name;
    if (selectedId) return n;
    if (viewing.status === "WRITING") {
      const who = (s.run.writer ?? (s.run.useAi ? s.setup.writer : null) ?? "").split(" ")[0];
      return who === "Claude" || who === "Gemini" ? `${who} is writing to ${n}…` : `Writing to ${n}…`;
    }
    if (viewing.status === "SENDING") return `Sending to ${n}…`;
    if (viewing.status === "SENT") return `Emailed ${n}`;
    if (viewing.status === "SKIPPED") return `Skipped ${n}`;
    if (viewing.status === "FAILED") return `Couldn't email ${n}`;
    return n;
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/emails" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft className="h-3.5 w-3.5" /> Emails</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {s.run.name}
            <Badge tone={st.tone} dot>{st.label}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted">From {s.setup.sender ?? "your email account"} · written by {s.run.writer ?? (s.run.useAi ? s.setup.writer ?? "your template" : "your template")}</p>
        </div>
        {canControl && (
          <div className="flex gap-2">
            {live && <Button variant="outline" onClick={() => control("pause")} loading={busy === "pause"}><Pause className="h-4 w-4" /> Pause</Button>}
            {s.run.status === "PAUSED" && <Button onClick={() => control("resume")} loading={busy === "resume"}><Play className="h-4 w-4" /> Resume</Button>}
            {["QUEUED", "RUNNING", "PAUSED"].includes(s.run.status) && <Button variant="ghost" onClick={() => setConfirmCancel(true)}><CircleStop className="h-4 w-4" /> Cancel</Button>}
          </div>
        )}
      </div>

      {s.setup.blockers.length > 0 && ["PAUSED", "QUEUED", "RUNNING"].includes(s.run.status) && (
        <Alert tone="warning" title={s.setup.blockers.map((b) => b.title).join(" · ")}>
          {s.setup.blockers[0]!.detail} <Link href={s.setup.blockers[0]!.href} className="font-medium underline">Fix it</Link>, then press Resume.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Emailed", v: s.run.sent, cls: "text-emerald-600", icon: <Check className="h-4 w-4" />, hint: s.run.replied ? <Link href="/emails?tab=replies" className="text-emerald-700 underline">{s.run.replied} replied — see what they said</Link> : null },
          { label: "Left to email", v: s.run.left, cls: "text-fg", icon: <Mail className="h-4 w-4" /> },
          { label: "Skipped", v: s.run.skipped, cls: "text-amber-600", icon: <SkipForward className="h-4 w-4" /> },
          { label: "Failed", v: s.run.failed, cls: "text-red-600", icon: <X className="h-4 w-4" /> },
        ].map((x) => (
          <Card key={x.label} className="p-4">
            <div className="flex items-center justify-between text-[13px] text-muted"><span>{x.label}</span><span className="text-faint">{x.icon}</span></div>
            <div className={cn("mt-1 text-[28px] font-semibold tabular-nums tracking-tight", x.cls)}>{x.v}</div>
            {"hint" in x && x.hint && <div className="mt-0.5 text-xs">{x.hint}</div>}
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 text-muted">
            {live && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
            {waiting ? <span><Clock className="mr-1 inline h-3.5 w-3.5" />{s.run.message?.split(" Next:")[0]} Next email{nextUp ? ` (${nextUp.business.name})` : ""} in <span className="font-semibold tabular-nums text-fg">{countdown}</span></span> : s.run.message}
          </span>
          <span className="tabular-nums text-muted">{done} of {s.run.total} done · {pct}%</span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-subtle">
          <div className="h-full bg-emerald-500 transition-[width] duration-700" style={{ width: `${s.run.total ? (s.run.sent / s.run.total) * 100 : 0}%` }} />
          <div className="h-full bg-amber-400 transition-[width] duration-700" style={{ width: `${s.run.total ? (s.run.skipped / s.run.total) * 100 : 0}%` }} />
          <div className="h-full bg-red-500 transition-[width] duration-700" style={{ width: `${s.run.total ? (s.run.failed / s.run.total) * 100 : 0}%` }} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className={cn("flex items-start justify-between gap-3 border-b border-border px-5 py-4", isLiveItem && "bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-transparent")}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                {viewing && <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", TONE_CLS[ITEM[viewing.status]?.tone ?? "zinc"])}>{ITEM[viewing.status]?.icon}</span>}
                <span className="truncate">{headline}</span>
              </div>
              {viewing && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{viewing.business.category ?? "Business"}{viewing.business.city ? ` · ${viewing.business.city}` : ""}</span>
                  <span className="font-mono">{viewing.email}</span>
                  {viewing.business.website && <a href={viewing.business.website} target="_blank" rel="noreferrer" className="underline hover:text-fg">website</a>}
                  <Link href={`/leads/${viewing.business.id}`} className="underline hover:text-fg">lead</Link>
                </div>
              )}
            </div>
            {selectedId && <Button size="sm" variant="outline" onClick={() => pick(null)}>Back to live</Button>}
          </div>

          {!viewing ? (
            <div className="px-5 py-16 text-center text-sm text-muted">{live ? "The first email is being prepared…" : "Nothing was sent in this run."}</div>
          ) : (
            <div className="grid gap-0 xl:grid-cols-2">
              <div className="border-b border-border p-5 xl:border-b-0 xl:border-r">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-faint">Prompt</div>
                  {viewing.writer && <Badge tone="violet" className="max-w-full whitespace-normal text-left">Written by {viewing.writer}</Badge>}
                </div>
                {viewing.prompt ? (
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-3 font-mono text-[11.5px] leading-relaxed text-muted">{viewing.prompt}</pre>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg bg-subtle p-3 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Gathering this business&apos;s facts and website findings…</div>
                )}
                {s.run.instructions && (
                  <div className="mt-3">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg" onClick={() => setShowInstructions((v) => !v)}>
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showInstructions && "rotate-180")} /> Instructions given to the AI for every email
                    </button>
                    {showInstructions && <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg border border-border p-3 font-mono text-[11px] leading-relaxed text-muted">{s.run.instructions}</pre>}
                  </div>
                )}
              </div>
              <div className="p-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Email</div>
                {viewing.subject ? (
                  <div className="rounded-lg border border-border">
                    <div className="space-y-1 border-b border-border px-4 py-3 text-xs">
                      <div><span className="text-faint">To:</span> <span className="font-mono">{viewing.email}</span></div>
                      <div><span className="text-faint">Subject:</span> <span className="font-medium text-fg">{viewing.subject}</span></div>
                    </div>
                    <div className="whitespace-pre-wrap px-4 py-3 text-[13.5px] leading-relaxed">
                      {selectedId ? viewing.body : body}
                      {!selectedId && live && body.length < (viewing.body?.length ?? 0) && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" />}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted"><PenLine className="h-4 w-4 animate-pulse" /> Writing…</div>
                )}
                {viewing.error && <Alert tone={viewing.status === "SKIPPED" ? "warning" : "danger"} className="mt-3">{viewing.error}</Alert>}
                {viewing.status === "SENT" && <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-600"><Check className="h-4 w-4" /> Sent {viewing.finishedAt ? new Date(viewing.finishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</div>}
              </div>
            </div>
          )}
        </Card>

        <Card className="flex max-h-[760px] flex-col overflow-hidden">
          <div className="flex gap-1 border-b border-border p-2">
            {([["all", `All ${s.items.length}`], ["left", `Left ${s.run.left}`], ["emailed", `Emailed ${s.run.sent}`], ["problems", `Issues ${s.run.skipped + s.run.failed}`]] as [ListTab, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium", tab === id ? "bg-subtle text-fg" : "text-muted hover:text-fg")}>{label}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.map((i) => {
              const m = ITEM[i.status] ?? ITEM.PENDING!;
              const active = (selectedId ?? s.current?.id) === i.id;
              return (
                <button key={i.id} onClick={() => pick(i.id === selectedId ? null : i.id)} className={cn("flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-subtle/60", active && "bg-accent/5")}>
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", TONE_CLS[m.tone])}>{m.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.business.name}</span>
                    <span className={cn("block truncate text-[11px]", i.replied ? "font-medium text-emerald-700" : "text-muted")}>{i.replied ? `Replied · ${i.replied}` : i.status === "SKIPPED" || i.status === "FAILED" ? i.error ?? m.label : `${i.business.city ?? ""}${i.business.city ? " · " : ""}${m.label}`}</span>
                  </span>
                </button>
              );
            })}
            {!list.length && <div className="p-6 text-center text-sm text-muted">Nothing here.</div>}
          </div>
        </Card>
      </div>

      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={() => control("cancel")} title="Cancel this run?" description={`${s.run.left} businesses haven't been emailed yet. They stay in your leads and can be emailed later.`} confirmLabel="Cancel run" tone="danger" loading={busy === "cancel"} />
    </div>
  );
}
