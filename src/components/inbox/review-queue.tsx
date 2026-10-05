"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Hand, Pencil, ShieldAlert, X } from "lucide-react";
import { Card, EmptyState, Badge } from "../ui/misc";
import { Button } from "../ui/button";
import { Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

import { INTENT_META } from "@/lib/constants";
import { SectionTabs } from "./inbox-list";
import { RelTime } from "@/components/ui/time";

export function ReviewQueue({ items, counts, perms }: { items: any[]; counts: Record<string, number>; perms: { approve: boolean; send: boolean } }) {
  return (
    <>
      <SectionTabs section="review" counts={counts} />
      {items.length === 0 ? (
        <Card><EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Review queue is empty" description="Messages that involve legal matters, complaints, payments, low confidence or anything unusual will appear here for a human." /></Card>
      ) : (
        <div className="space-y-4">{items.map((c) => <ReviewCard key={c.id} c={c} perms={perms} />)}</div>
      )}
    </>
  );
}

function ReviewCard({ c, perms }: { c: any; perms: { approve: boolean; send: boolean } }) {
  const router = useRouter();
  const toast = useToast();
  const msg = c.messages[0];
  const draft = c.drafts[0];
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState<string>(draft?.body ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); router.refresh(); } catch (e) { toast.error("Action failed", (e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <Link href={`/inbox/${c.id}`} className="font-semibold hover:text-accent">{c.business?.name ?? c.counterpartEmail}</Link>
          <span className="ml-2 text-xs text-muted">{c.counterpartEmail} · <RelTime d={c.lastMessageAt} /></span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {c.lastIntent && <Badge tone={INTENT_META[c.lastIntent]?.tone}>{INTENT_META[c.lastIntent]?.label}</Badge>}
          {c.lastConfidence != null && <Badge tone={c.lastConfidence >= 80 ? "green" : c.lastConfidence >= 60 ? "amber" : "red"}>{c.lastConfidence}% confidence</Badge>}
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-2">
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-faint">Incoming message</div>
          <p className="whitespace-pre-wrap text-sm">{(msg?.bodyText ?? "").slice(0, 1200)}</p>
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[13px]">
            <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200"><ShieldAlert className="h-4 w-4" /> Why this was flagged</div>
            <p className="mt-1 text-muted">{c.reviewReason ?? "Low confidence"}</p>
          </div>
        </div>
        <div className="p-5">
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-faint">Suggested response</div>
          {draft ? (editing ? <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[180px]" aria-label="Edit suggested response" /> : <p className="whitespace-pre-wrap text-sm">{draft.body}</p>) : <p className="text-sm text-muted">No AI draft — reply personally.</p>}
          {draft?.missingInfo?.length > 0 && <p className="mt-2 text-xs text-warning">Needs information you haven&apos;t configured: {draft.missingInfo.join(", ")}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
        {draft && perms.approve && <Button size="sm" loading={busy === "approve"} onClick={() => run("approve", () => apiFetch(`/api/drafts/${draft.id}/approve`, { body: editing ? { body } : {} }), "Response sent")}><CheckCircle2 className="h-4 w-4" /> Approve & Send</Button>}
        {draft && perms.approve && <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}><Pencil className="h-4 w-4" /> {editing ? "Done editing" : "Edit"}</Button>}
        {draft && perms.approve && <Button size="sm" variant="outline" loading={busy === "reject"} onClick={() => run("reject", () => apiFetch(`/api/drafts/${draft.id}/reject`, { body: {} }), "Draft rejected")}><X className="h-4 w-4" /> Reject</Button>}
        {perms.send && <Button size="sm" variant="ghost" loading={busy === "take"} onClick={() => run("take", () => apiFetch(`/api/conversations/${c.id}/control`, { body: { action: "TAKE_OVER" } }).then(() => router.push(`/inbox/${c.id}`)), "You've taken over this conversation")}><Hand className="h-4 w-4" /> Take Over</Button>}
      </div>
    </Card>
  );
}
