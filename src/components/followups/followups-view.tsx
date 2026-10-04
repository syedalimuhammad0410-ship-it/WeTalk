"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Send, X } from "lucide-react";
import { Card, EmptyState, Badge, Alert } from "../ui/misc";
import { Button } from "../ui/button";
import { Tabs } from "../ui/tabs";
import { Field, Input, Textarea } from "../ui/form";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { formatDateTime } from "@/lib/utils";

type T = "due" | "scheduled" | "sent" | "stopped";

export function FollowUpsView({ items, canSend, automatic }: { items: any[]; canSend: boolean; automatic: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const groups: Record<T, any[]> = {
    due: items.filter((i) => i.status === "PENDING_APPROVAL"),
    scheduled: items.filter((i) => i.status === "SCHEDULED"),
    sent: items.filter((i) => i.status === "SENT").reverse(),
    stopped: items.filter((i) => ["CANCELLED", "FAILED"].includes(i.status)).reverse(),
  };
  const [tab, setTab] = useState<T>(groups.due.length ? "due" : "scheduled");
  const [editing, setEditing] = useState<any | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(id: string, edits?: { subject: string; body: string }) {
    setBusy(id);
    try {
      const r = await apiFetch<{ sandbox: boolean }>(`/api/follow-ups/${id}/approve`, { body: edits ?? {} });
      toast.success(r.sandbox ? "Follow-up recorded (sandbox)" : "Follow-up sent");
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast.error("Not sent", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const list = groups[tab];
  return (
    <div className="space-y-4">
      <Alert tone="info" title={automatic ? "Automatic follow-ups are ON" : "Follow-ups require approval"}>{automatic ? "Due follow-ups in campaigns set to automatic are sent within your limits. Others wait here." : "When a follow-up is due it appears under “Due for approval”. Change this in Settings → Automation."}</Alert>
      <Tabs<T> value={tab} onChange={setTab} tabs={[{ id: "due", label: "Due for approval", count: groups.due.length }, { id: "scheduled", label: "Scheduled", count: groups.scheduled.length }, { id: "sent", label: "Sent", count: groups.sent.length }, { id: "stopped", label: "Stopped", count: groups.stopped.length }]} />
      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="Nothing here" description={tab === "due" ? "No follow-ups are waiting for approval." : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((f) => (
              <li key={f.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Link href={`/leads/${f.business.id}`} className="font-medium hover:text-accent">{f.business.name}</Link><Badge tone="slate">Step {f.step}</Badge>{f.campaign && <Badge tone="indigo">{f.campaign.name}</Badge>}{f.automatic && <Badge tone="violet">Automatic</Badge>}</div>
                  <div className="mt-0.5 text-xs text-muted">{tab === "sent" ? "Sent" : "Scheduled for"} {formatDateTime(f.scheduledFor)}{f.cancelReason && ` · ${f.cancelReason}`}</div>
                  {f.subject && <div className="mt-1 truncate text-[13px]">{f.subject}</div>}
                </div>
                {canSend && ["PENDING_APPROVAL", "SCHEDULED"].includes(f.status) && (
                  <div className="flex gap-2">
                    {f.status === "PENDING_APPROVAL" && <Button size="sm" variant="outline" onClick={() => { setEditing(f); setSubject(f.subject ?? ""); setBody(f.body ?? ""); }}>Review</Button>}
                    {f.status === "PENDING_APPROVAL" && <Button size="sm" loading={busy === f.id} onClick={() => approve(f.id)}><Send className="h-4 w-4" /> Approve & send</Button>}
                    <Button size="sm" variant="ghost" onClick={async () => { await apiFetch(`/api/follow-ups/${f.id}/cancel`, { body: {} }).catch((e) => toast.error((e as Error).message)); router.refresh(); }}><X className="h-4 w-4" /> Cancel</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={`Follow-up ${editing?.step} for ${editing?.business?.name}`} description={`To ${editing?.business?.email ?? "—"}`} size="lg"
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy === editing?.id} onClick={() => approve(editing.id, { subject, body })}><Send className="h-4 w-4" /> Approve & send</Button></>}>
        <div className="space-y-4">
          <Field label="Subject" htmlFor="fs"><Input id="fs" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Message" htmlFor="fb"><Textarea id="fb" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[200px]" /></Field>
        </div>
      </Dialog>
    </div>
  );
}
