"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, MessagesSquare, StickyNote, Trash2 } from "lucide-react";
import { Card, CardHeader, EmptyState, Badge } from "../ui/misc";
import { Button } from "../ui/button";
import { Textarea } from "../ui/form";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { INTENT_META } from "@/lib/constants";
import type { LeadData, LeadPerms } from "./types";
import { RelTime, DateTimeText } from "@/components/ui/time";

export function ConversationTab({ data }: { data: LeadData }) {
  if (!data.conversations.length) return <Card><EmptyState icon={<MessagesSquare className="h-5 w-5" />} title="No conversations yet" description="Conversations appear here once you send outreach or the business emails you." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {data.conversations.map((c: any) => (
          <li key={c.id}>
            <Link href={`/inbox/${c.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-subtle/60">
              <MessagesSquare className="h-4 w-4 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{c.subject}{c.unread && <Badge tone="indigo">Unread</Badge>}{c.needsHumanReview && <Badge tone="amber">Needs review</Badge>}{c.lastIntent && <Badge tone={INTENT_META[c.lastIntent]?.tone}>{INTENT_META[c.lastIntent]?.label}</Badge>}</div>
                <div className="text-xs text-muted">{c.counterpartEmail} · <RelTime d={c.lastMessageAt} /></div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function FollowUpsTab({ data, perms }: { data: LeadData; perms: LeadPerms }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const active = data.followUps.filter((f: any) => ["SCHEDULED", "PENDING_APPROVAL"].includes(f.status));
  if (!data.followUps.length) return <Card><EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No follow-ups" description="Follow-ups are scheduled automatically after the first outreach email, up to your workspace maximum." /></Card>;
  return (
    <Card>
      <CardHeader title="Follow-up schedule" description="Stops automatically when the business replies, declines, unsubscribes or becomes a customer." action={perms.send && active.length > 0 && <Button size="sm" variant="outline" loading={busy} onClick={async () => { setBusy(true); try { const r = await apiFetch<{ cancelled: number }>(`/api/leads/${data.business.id}/follow-ups`, { method: "DELETE" }); toast.success(`${r.cancelled} follow-up(s) stopped`); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>Stop all follow-ups</Button>} />
      <ul className="divide-y divide-border">
        {data.followUps.map((f: any) => (
          <li key={f.id} className="flex items-center gap-3 px-5 py-3 text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-subtle text-xs font-semibold">{f.step}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Follow-up {f.step} · <DateTimeText d={f.scheduledFor} /></div>
              <div className="text-xs text-muted">{f.automatic ? "Automatic" : "Approval required"}{f.cancelReason && ` · ${f.cancelReason}`}</div>
            </div>
            <Badge tone={{ SCHEDULED: "blue", PENDING_APPROVAL: "amber", SENT: "green", CANCELLED: "zinc", FAILED: "red" }[f.status as string] as any}>{f.status.replace("_", " ").toLowerCase()}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ActivityTab({ data }: { data: LeadData }) {
  return (
    <Card>
      <CardHeader title="Timeline" description="Every action on this lead, newest first." />
      <ol className="relative px-5 py-4">
        <span className="absolute bottom-6 left-[27px] top-6 w-px bg-border" aria-hidden />
        {data.activity.map((a: any) => (
          <li key={a.id} className="relative flex gap-4 py-2.5">
            <span className="relative z-[1] mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-surface bg-accent ring-2 ring-accent/20" aria-hidden />
            <div>
              <p className="text-sm">{a.summary}</p>
              <p className="text-xs text-faint"><DateTimeText d={a.createdAt} /> · {a.user?.name ?? "System"}</p>
            </div>
          </li>
        ))}
        {data.activity.length === 0 && <li className="py-6 text-center text-sm text-muted">No activity yet.</li>}
      </ol>
    </Card>
  );
}

export function NotesTab({ data, perms, currentUserId }: { data: LeadData; perms: LeadPerms; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {data.notes.length === 0 && <Card><EmptyState icon={<StickyNote className="h-5 w-5" />} title="No notes yet" description="Notes are private to your workspace." /></Card>}
        {data.notes.map((n: any) => (
          <Card key={n.id} className="p-4">
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-faint">
              <span>{n.author?.name ?? "Unknown"} · <DateTimeText d={n.createdAt} /></span>
              {(n.author?.id === currentUserId || perms.del) && <button className="text-faint hover:text-danger" aria-label="Delete note" onClick={async () => { await apiFetch(`/api/notes/${n.id}`, { method: "DELETE" }).catch((e) => toast.error((e as Error).message)); router.refresh(); }}><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          </Card>
        ))}
      </div>
      {perms.edit && (
        <Card className="h-fit p-4">
          <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await apiFetch(`/api/leads/${data.business.id}/notes`, { body: { body } }); setBody(""); router.refresh(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); } }}>
            <label htmlFor="note" className="label">Add a note</label>
            <Textarea id="note" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Owner asked us to call Friday." />
            <Button type="submit" className="mt-3 w-full" loading={busy} disabled={!body.trim()}>Save note</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
