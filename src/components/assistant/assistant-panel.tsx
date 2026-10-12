"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Check, Loader2, RotateCcw, Send, Sparkles, Wrench, X, AlertTriangle } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { kickJobs } from "../shell/job-tray";

type Step = { tool: string; ok: boolean; summary: string };
type Pending = { tool: string; args: unknown; summary: string };
type Msg = { role: "user" | "assistant"; content: string; steps?: Step[]; pending?: Pending | null; error?: boolean; resolved?: "confirmed" | "cancelled" };

const STORE = "ws_assistant_chat";
const SUGGESTIONS = [
  "What should I work on today?",
  "Find 20 dentists in Mississauga without a website",
  "Show my best leads that haven't been contacted",
  "Write an outreach email for my top lead",
  "Any replies in the inbox that need me?",
  "Clean up my inbox",
];
const TOOL_LABEL: Record<string, string> = {
  overview: "Checked workspace overview", search_leads: "Searched leads", get_lead: "Read lead details", list_inbox: "Checked inbox", read_conversation: "Read conversation",
  list_jobs: "Checked background jobs", list_campaigns: "Checked campaigns", get_company_profile: "Read company profile", change_lead_status: "Changed lead status",
  add_note: "Added note", tag_leads: "Tagged leads", run_website_audits: "Queued website audits", generate_website_prompts: "Queued website prompts",
  draft_outreach_email: "Drafted outreach email", find_businesses: "Started business search", add_leads_to_campaign: "Added leads to campaign",
  set_conversation_related: "Updated inbox filtering", clean_up_inbox: "Started inbox clean-up", send_email: "Send email", approve_reply_draft: "Send AI reply", mark_do_not_contact: "Do Not Contact",
};

/** Renders assistant text: paragraphs, "- " lists, **bold** and internal [links](/path). */
function RichText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const inline = (s: string, key: string) => {
    const parts: React.ReactNode[] = [];
    const re = /\[([^\]]+)\]\((\/[^)\s]*)\)|\*\*([^*]+)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      if (m[1]) parts.push(<Link key={`${key}-${i++}`} href={m[2]!} onClick={onNavigate} className="font-medium text-accent underline-offset-2 hover:underline">{m[1]}</Link>);
      else parts.push(<strong key={`${key}-${i++}`}>{m[3]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, bi) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return <ul key={bi} className="list-disc space-y-0.5 pl-4">{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-•*]\s+/, ""), `${bi}-${li}`)}</li>)}</ul>;
        return <p key={bi} className="whitespace-pre-wrap">{inline(b, String(bi))}</p>;
      })}
    </div>
  );
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "webscout" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { const saved = sessionStorage.getItem(STORE); if (saved) setMsgs(JSON.parse(saved) as Msg[]); } catch { /* optional */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { /* optional */ }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const afterChange = () => { kickJobs(); router.refresh(); };

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const history = next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
      const r = await post<{ reply: string; steps: Step[]; pending: Pending | null; changed: boolean }>("/api/assistant", { messages: history });
      setMsgs((m) => [...m, { role: "assistant", content: r.reply, steps: r.steps, pending: r.pending }]);
      if (r.changed) afterChange();
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  async function decide(index: number, confirm: boolean) {
    const msg = msgs[index];
    if (!msg?.pending) return;
    setMsgs((m) => m.map((x, i) => (i === index ? { ...x, resolved: confirm ? "confirmed" : "cancelled" } : x)));
    if (!confirm) {
      setMsgs((m) => [...m, { role: "assistant", content: "Okay — cancelled. Nothing was changed." }]);
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ result: { link?: string; sandbox?: boolean } }>("/api/assistant/confirm", { tool: msg.pending.tool, args: msg.pending.args });
      const link = r.result?.link ? ` [Open](${r.result.link})` : "";
      setMsgs((m) => [...m, { role: "assistant", content: `Done: ${msg.pending!.summary}.${r.result?.sandbox ? " (Sandbox — recorded, not delivered.)" : ""}${link}` }]);
      afterChange();
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `That didn't go through: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex justify-end lg:inset-auto lg:bottom-4 lg:right-4 lg:top-auto" role="dialog" aria-modal="false" aria-label="WebScout AI assistant">
      <div className="absolute inset-0 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full flex-col overflow-hidden border-border bg-surface shadow-pop sm:max-w-md lg:h-[min(720px,calc(100vh-2rem))] lg:w-[420px] lg:rounded-2xl lg:border">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">WebScout AI</h2>
            <p className="truncate text-xs text-muted">Ask anything or tell me what to do</p>
          </div>
          {msgs.length > 0 && <button onClick={() => setMsgs([])} className="rounded-lg p-2 text-muted hover:bg-subtle" aria-label="New chat" title="New chat"><RotateCcw className="h-4 w-4" /></button>}
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-subtle" aria-label="Close assistant"><X className="h-4 w-4" /></button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13.5px] leading-relaxed" aria-live="polite">
          {msgs.length === 0 && (
            <div className="space-y-3">
              <div className="flex gap-2.5"><Bot className="mt-0.5 h-5 w-5 shrink-0 text-accent" /><p>Hi! I can find businesses, look up leads, run audits, write outreach drafts, check your inbox and more. I always ask before sending anything.</p></div>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-border bg-subtle/60 px-3 py-1.5 text-left text-xs text-fg hover:border-accent/50">{s}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[90%] rounded-2xl px-3.5 py-2.5", m.role === "user" ? "bg-accent text-white" : m.error ? "border border-danger/30 bg-danger/5 text-fg" : "bg-subtle text-fg")}>
                {m.steps && m.steps.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {m.steps.map((s, si) => (
                      <span key={si} title={s.summary} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]", s.ok ? "bg-surface text-muted" : "bg-danger/10 text-danger")}>
                        {s.ok ? <Wrench className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{TOOL_LABEL[s.tool] ?? s.tool}
                      </span>
                    ))}
                  </div>
                )}
                {m.role === "assistant" ? <RichText text={m.content} onNavigate={() => { if (window.innerWidth < 1024) onClose(); }} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                {m.pending && (
                  <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Needs your confirmation</p>
                    <p className="mt-1 text-[13px]">{m.pending.summary}</p>
                    {m.resolved ? (
                      <p className="mt-2 text-xs text-muted">{m.resolved === "confirmed" ? "Confirmed." : "Cancelled."}</p>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => decide(i, true)} disabled={busy}><Check className="h-4 w-4" /> Confirm</Button>
                        <Button size="sm" variant="outline" onClick={() => decide(i, false)} disabled={busy}>Cancel</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Working on it…</div>}
          <div ref={endRef} />
        </div>

        <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            placeholder="e.g. Audit all my leads in Brampton" aria-label="Message WebScout AI"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
          <Button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </div>
  );
}
