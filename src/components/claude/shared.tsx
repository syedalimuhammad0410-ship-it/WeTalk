"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { Badge } from "../ui/misc";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

export type ClaudeTask = { id: string; type: string; title: string; status: string; progress: number; progressMessage: string | null; createdAt: string; finishedAt: string | null; summary: string | null; error: string | null; stats: Record<string, number> };
export type ClaudeEvent = { id: string; type: string; message: string; createdAt: string; taskId: string | null; businessId: string | null; task?: { title: string } | null };

export const shortId = (id: string) => id.slice(-6);

const STATUS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Waiting for Claude", tone: "amber" },
  RUNNING: { label: "Running", tone: "blue" },
  PAUSED: { label: "Paused", tone: "zinc" },
  COMPLETED: { label: "Completed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "zinc" },
};
export function TaskStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.toLowerCase(), tone: "slate" as Tone };
  return <Badge tone={s.tone} dot={status === "RUNNING"}>{s.label}</Badge>;
}

const EVENT_TONE: Record<string, string> = {
  BUSINESS_CREATED: "bg-emerald-500", CONTACT_VERIFIED: "bg-emerald-500", COMPLETED: "bg-emerald-500",
  BUSINESS_DUPLICATE: "bg-zinc-400", TASK_CREATED: "bg-zinc-400", PROGRESS: "bg-zinc-400", AUDITS_QUEUED: "bg-zinc-400",
  BUSINESS_REJECTED: "bg-amber-500", CONTACT_REJECTED: "bg-amber-500",
  FACTS_ADDED: "bg-sky-500", CLAIMED: "bg-sky-500", CONTINUED: "bg-sky-500", CLAUDE_CONNECTED: "bg-sky-500", COMPANION_CONNECTED: "bg-sky-500", RESUMED: "bg-sky-500", RETRY: "bg-sky-500",
  DRAFT_CREATED: "bg-violet-500",
  PAUSED: "bg-red-500", CANCELLED: "bg-red-500", FAILED: "bg-red-500", ERROR: "bg-red-500",
};

const clock = (d: string) => new Date(d).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** One line of the live activity feed. */
export function EventRow({ e, showTask }: { e: ClaudeEvent; showTask?: boolean }) {
  return (
    <li className="flex gap-3 py-1.5 text-sm">
      <span className="w-[4.2rem] shrink-0 font-mono text-xs tabular-nums leading-5 text-faint" suppressHydrationWarning>{clock(e.createdAt)}</span>
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", EVENT_TONE[e.type] ?? "bg-zinc-400")} aria-hidden />
      <span className="min-w-0 flex-1 leading-5">
        {e.businessId ? <Link href={`/leads/${e.businessId}`} className="hover:underline">{e.message}</Link> : e.message}
        {showTask && e.task && e.taskId && <Link href={`/claude/tasks/${e.taskId}`} className="ml-1 text-xs text-muted hover:underline">· {e.task.title}</Link>}
      </span>
    </li>
  );
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium hover:bg-subtle", className)}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

/** The sentence to say to Claude for a task. */
export const sayToClaude = (taskId?: string) => (taskId ? `Run my WebScout task ${shortId(taskId)}` : "Run my next WebScout task");
