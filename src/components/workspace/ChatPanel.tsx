"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowUp, Bot, Check, Loader2, Play } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { cn } from "@/components/ui";

const SUGGESTIONS = ["What did you find?", "Why do you think this is the location?", "What other locations could this be?", "Show me the evidence.", "What information is missing?", "Search news about this place", "Create a timeline", "Focus only on the logo"];

function renderText(text: string, onSource: (id: string) => void) {
  const parts = text.split(/(\[source:[a-zA-Z0-9_]+\]|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[source:([a-zA-Z0-9_]+)\]$/);
    if (m)
      return (
        <button key={i} onClick={() => onSource(m[1])} className="mx-0.5 rounded-[3px] border border-cyan/40 px-1 font-mono text-[10px] text-cyan hover:bg-cyan/10">
          src
        </button>
      );
    if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });
}

export function ChatPanel() {
  const inv = useWorkspace((s) => s.inv);
  const busy = useWorkspace((s) => s.chatBusy);
  const providers = useWorkspace((s) => s.providers);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [inv?.chat.length, busy]);
  if (!inv) return null;
  const send = (m: string) => {
    const t = m.trim();
    if (!t) return;
    setText("");
    void ws.chat(t);
  };
  const openSource = (id: string) => {
    ws.set({ tab: "sources" });
    setTimeout(() => document.getElementById(`source-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  };
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <div className="relative grid size-7 place-items-center rounded-full border border-cyan/40">
          <Bot className="size-3.5 text-cyan" />
        </div>
        <div>
          <div className="text-[13px] font-semibold tracking-wide">TRACE AI</div>
          <div className="label-mono !text-[9px] text-mute">{providers?.ai ? "Claude · tools enabled" : "Investigation assistant · rules engine"}</div>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {!inv.chat.length && (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-dim">I know everything in this investigation: clues, searches, candidates, evidence and sources. Ask me questions or tell me what to do.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line-strong px-2.5 py-1 text-[11.5px] text-dim hover:border-cyan/40 hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {inv.chat.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("text-[13px] leading-relaxed", m.role === "user" ? "ml-8 rounded-[6px] bg-white/[0.06] px-3 py-2" : "")}>
            {m.role === "assistant" && <div className="label-mono mb-1 !text-[9px] text-cyan">TRACE AI {m.engine && m.engine !== "rules" ? `· ${m.engine.split(":")[0]}` : ""}</div>}
            <div className="whitespace-pre-wrap break-words">{renderText(m.content, openSource)}</div>
            {!!m.actions?.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.actions.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => (a.type === "reset" ? ws.set({ confirmReset: true }) : ws.runAction(a, m.id))}
                    className={cn("inline-flex items-center gap-1 rounded-[4px] border px-2 py-1 text-[11.5px]", a.status === "done" ? "border-ok/30 text-ok" : "border-cyan/40 text-cyan hover:bg-cyan/10")}
                  >
                    {a.status === "done" ? <Check className="size-3" /> : <Play className="size-3" />} {a.label}
                  </button>
                ))}
              </div>
            )}
            {!!m.sourceIds?.length && (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.sourceIds.slice(0, 8).map((id) => {
                  const s = inv.sources.find((x) => x.id === id);
                  return s ? (
                    <button key={id} onClick={() => openSource(id)} className="max-w-[200px] truncate rounded-[3px] border border-line px-1.5 py-0.5 text-[10.5px] text-mute hover:text-fg" title={s.title}>
                      {s.publisher}
                    </button>
                  ) : null;
                })}
              </div>
            )}
          </motion.div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-mute">
            <Loader2 className="size-3.5 animate-spin text-cyan" /> Working…
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <div className="flex items-end gap-2 rounded-[6px] border border-line-strong bg-black/30 p-1.5 focus-within:border-cyan/50">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            rows={1}
            placeholder="Ask TRACE AI or give a command…"
            aria-label="Message TRACE AI"
            className="max-h-32 min-h-[34px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] placeholder:text-mute focus:outline-none"
          />
          <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid size-8 place-items-center rounded-[5px] bg-fg text-ink disabled:opacity-30">
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
