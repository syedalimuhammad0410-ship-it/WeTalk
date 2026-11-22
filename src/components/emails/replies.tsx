"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Flame, MailOpen, MessageSquareReply, RefreshCw, Search } from "lucide-react";
import { Badge, Card, EmptyState } from "../ui/misc";
import { Button } from "../ui/button";
import { Input } from "../ui/form";
import { RelTime } from "../ui/time";
import { cn } from "@/lib/utils";

export type ReplyRow = {
  businessId: string; name: string; category: string | null; city: string | null; conversationId: string | null; from: string; subject: string; at: string;
  intent: string | null; intentLabel: string; group: string; confidence: number | null; summary: string; nextStep: string | null; messages: number; hot: boolean; needsReview: boolean; youReplied: boolean;
};

const GROUPS: { id: string; label: string; tone: "emerald" | "sky" | "violet" | "zinc" | "red" | "slate" | "amber" }[] = [
  { id: "interested", label: "Interested", tone: "emerald" },
  { id: "question", label: "Asked a question", tone: "sky" },
  { id: "pricing", label: "Asked about price", tone: "violet" },
  { id: "not_interested", label: "Not interested", tone: "zinc" },
  { id: "unsubscribed", label: "Unsubscribed / complaint", tone: "red" },
  { id: "other", label: "Auto-reply / other", tone: "slate" },
  { id: "pending", label: "Being read", tone: "amber" },
];
const toneOf = (g: string) => GROUPS.find((x) => x.id === g)?.tone ?? "slate";

export function RepliesView({ replies }: { replies: ReplyRow[] }) {
  const router = useRouter();
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of replies) m.set(r.group, (m.get(r.group) ?? 0) + 1);
    return m;
  }, [replies]);
  const shown = replies.filter((r) => (group === "all" || r.group === group) && (!q.trim() || `${r.name} ${r.summary} ${r.from} ${r.city ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));

  if (!replies.length) {
    return (
      <Card>
        <EmptyState icon={<MessageSquareReply className="h-5 w-5" />} title="No replies yet" description="When a business emails you back, it shows up here with what they said and what to do next. Replies are checked every couple of minutes." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{replies.length}</span> <span className="text-muted">{replies.length === 1 ? "business has" : "businesses have"} emailed you back</span>
            {(counts.get("interested") ?? 0) > 0 && <span className="ml-2 font-medium text-emerald-600">· {counts.get("interested")} interested</span>}
          </div>
          <Button size="sm" variant="ghost" onClick={() => router.refresh()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setGroup("all")} className={cn("rounded-full border px-3 py-1 text-xs font-medium", group === "all" ? "border-accent bg-accent text-white" : "border-border text-muted hover:text-fg")}>All <span className="ml-1 opacity-75">{replies.length}</span></button>
          {GROUPS.filter((g) => counts.get(g.id)).map((g) => (
            <button key={g.id} onClick={() => setGroup(g.id)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", group === g.id ? "border-accent bg-accent text-white" : "border-border text-muted hover:text-fg")}>
              {g.label} <span className="ml-1 opacity-75">{counts.get(g.id)}</span>
            </button>
          ))}
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search replies…" className="pl-9" aria-label="Search replies" />
        </div>
      </Card>

      <div className="space-y-2">
        {shown.map((r) => (
          <Card key={r.businessId} className={cn("p-4", r.hot && "border-emerald-400/60")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneOf(r.group)} dot>{r.intentLabel}</Badge>
                  <Link href={`/leads/${r.businessId}`} className="truncate font-semibold hover:underline">{r.name}</Link>
                  {r.hot && <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600"><Flame className="h-3.5 w-3.5" /> Hot lead</span>}
                  {r.needsReview && <Badge tone="amber">Needs your review</Badge>}
                  {r.youReplied && <Badge tone="sky">You replied</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {[r.category, r.city].filter(Boolean).join(" · ")}{(r.category || r.city) && " · "}<span className="font-mono">{r.from}</span> · <RelTime d={r.at} />{r.messages > 1 && ` · ${r.messages} messages`}
                </div>
                <p className="mt-2 text-sm leading-relaxed"><span className="text-muted">What they said: </span>{r.summary}</p>
                {r.nextStep && <p className="mt-1 text-xs text-muted"><span className="font-medium text-fg">Next step:</span> {r.nextStep}</p>}
              </div>
              {r.conversationId && (
                <Link href={`/inbox/${r.conversationId}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:border-faint hover:bg-subtle">
                  <MailOpen className="h-4 w-4" /> Open <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </Card>
        ))}
        {!shown.length && <Card className="p-6 text-center text-sm text-muted">No replies match.</Card>}
      </div>
    </div>
  );
}
