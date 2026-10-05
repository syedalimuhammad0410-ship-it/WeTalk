"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Sparkles, ShieldAlert, Flame } from "lucide-react";
import { Card, EmptyState, Badge } from "../ui/misc";
import { ButtonLink } from "../ui/button";
import { Tabs } from "../ui/tabs";
import { cn } from "@/lib/utils";
import { INBOX_SECTIONS, INTENT_META, LEAD_STATUS_META, type InboxSection, type LeadStatusT } from "@/lib/constants";
import { RelTime } from "@/components/ui/time";

export function SectionTabs({ section, counts }: { section: InboxSection; counts: Record<string, number> }) {
  const router = useRouter();
  return <Tabs<InboxSection> value={section} onChange={(s) => router.push(`/inbox?section=${s}`)} tabs={INBOX_SECTIONS.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] }))} className="mb-4" />;
}

export function InboxList({ section, counts, conversations, page }: { section: InboxSection; counts: Record<string, number>; conversations: any[]; page: number }) {
  return (
    <>
      <SectionTabs section={section} counts={counts} />
      <Card className="overflow-hidden">
        {conversations.length === 0 ? (
          <EmptyState icon={<Inbox className="h-5 w-5" />} title={section === "all" ? "No responses yet." : "Nothing here right now."} description={section === "all" ? "When businesses reply to your outreach, conversations show up here automatically." : undefined} action={section === "all" && <ButtonLink href="/campaigns">Start an Outreach Campaign</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-border">
            {conversations.map((c) => {
              const draft = c.drafts?.[0];
              const last = c.messages?.[0];
              return (
                <li key={c.id}>
                  <Link href={`/inbox/${c.id}`} className={cn("flex gap-3 px-4 py-3.5 transition-colors hover:bg-subtle/60 sm:px-5", c.unread && "bg-accent/[0.035]")}>
                    <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", c.unread ? "bg-accent" : "bg-transparent")} aria-label={c.unread ? "Unread" : undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.business?.name ?? c.counterpartEmail}</span>
                          <span className="ml-2 hidden text-xs text-muted sm:inline">{c.counterpartEmail}</span>
                        </div>
                        <span className="shrink-0 text-xs text-faint"><RelTime d={c.lastMessageAt} /></span>
                      </div>
                      <div className="truncate text-[13px] text-muted">{c.subject} — {last?.direction === "OUTBOUND" ? "You: " : ""}{(last?.bodyText ?? "").slice(0, 140)}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {c.isHot && <Badge tone="orange"><Flame className="h-3 w-3" /> Hot</Badge>}
                        {c.lastIntent && <Badge tone={INTENT_META[c.lastIntent]?.tone}>{INTENT_META[c.lastIntent]?.label}{c.lastConfidence != null && ` · ${c.lastConfidence}%`}</Badge>}
                        {draft && <Badge tone="violet"><Sparkles className="h-3 w-3" /> AI draft ready</Badge>}
                        {c.needsHumanReview && <Badge tone="amber"><ShieldAlert className="h-3 w-3" /> Needs review</Badge>}
                        {c.business && <Badge tone={LEAD_STATUS_META[c.business.status as LeadStatusT]?.tone}>{LEAD_STATUS_META[c.business.status as LeadStatusT]?.label}</Badge>}
                        {c.assignedTo && <span className="text-xs text-faint">· {c.assignedTo}</span>}
                        {!c.isOpen && <Badge tone="zinc">Closed</Badge>}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {conversations.length === 50 && <div className="border-t border-border p-3 text-center text-sm"><Link className="text-accent" href={`/inbox?section=${section}&page=${page + 1}`}>Older conversations →</Link></div>}
      </Card>
    </>
  );
}
