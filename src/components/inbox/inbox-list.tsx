"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Sparkles, ShieldAlert, Flame, Filter } from "lucide-react";
import { Card, EmptyState, Badge } from "../ui/misc";
import { ButtonLink } from "../ui/button";
import { Tabs } from "../ui/tabs";
import { cn } from "@/lib/utils";
import { EMAIL_CATEGORIES, INBOX_SECTIONS, INTENT_META, LEAD_STATUS_META, type InboxSection, type LeadStatusT } from "@/lib/constants";

const CATEGORY_META: Record<string, { label: string; tone: (typeof EMAIL_CATEGORIES)[number]["tone"] }> = Object.fromEntries(EMAIL_CATEGORIES.map((c) => [c.id, { label: c.label, tone: c.tone }]));
import { RelTime } from "@/components/ui/time";
import { InboxFilters, inboxHref, type InboxFilterState } from "./inbox-filters";

export function SectionTabs({ section, counts, filters = {} }: { section: InboxSection; counts: Record<string, number>; filters?: InboxFilterState }) {
  const router = useRouter();
  return <Tabs<InboxSection> value={section} onChange={(s) => router.push(inboxHref(s, filters))} tabs={INBOX_SECTIONS.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] }))} className="mb-4" />;
}

export function InboxList({ section, counts, conversations, page, filters = {}, categoryCounts }: { section: InboxSection; counts: Record<string, number>; conversations: any[]; page: number; filters?: InboxFilterState; categoryCounts?: { byCategory: Record<string, number>; contacted: number } }) {
  const filtered = Boolean(filters.cat || filters.contacted || filters.link || filters.intent || filters.days || filters.q);
  return (
    <>
      <SectionTabs section={section} counts={counts} filters={filters} />
      {categoryCounts && <InboxFilters section={section} filters={filters} counts={categoryCounts} />}
      <Card className="overflow-hidden">
        {conversations.length === 0 ? (
          <EmptyState icon={<Inbox className="h-5 w-5" />} title={filtered ? "No emails match these filters." : section === "all" ? "No responses yet." : "Nothing here right now."} description={section === "all" ? "When businesses reply to your outreach, conversations show up here automatically." : undefined} action={section === "all" && <ButtonLink href="/campaigns">Start an Outreach Campaign</ButtonLink>} />
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
                        {c.category && c.category !== "lead_reply" && CATEGORY_META[c.category] && <Badge tone={CATEGORY_META[c.category]!.tone}>{CATEGORY_META[c.category]!.label}</Badge>}
                        {c.lastIntent && <Badge tone={INTENT_META[c.lastIntent]?.tone}>{INTENT_META[c.lastIntent]?.label}{c.lastConfidence != null && ` · ${c.lastConfidence}%`}</Badge>}
                        {draft && <Badge tone="violet"><Sparkles className="h-3 w-3" /> AI draft ready</Badge>}
                        {c.needsHumanReview && <Badge tone="amber"><ShieldAlert className="h-3 w-3" /> Needs review</Badge>}
                        {c.business && <Badge tone={LEAD_STATUS_META[c.business.status as LeadStatusT]?.tone}>{LEAD_STATUS_META[c.business.status as LeadStatusT]?.label}</Badge>}
                        {c.assignedTo && <span className="text-xs text-faint">· {c.assignedTo}</span>}
                        {c.filtered ? <Badge tone="zinc"><Filter className="h-3 w-3" /> Not related{c.filterReason ? ` — ${c.filterReason}` : ""}</Badge> : !c.isOpen && <Badge tone="zinc">Closed</Badge>}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {conversations.length === 50 && <div className="border-t border-border p-3 text-center text-sm"><Link className="text-accent" href={inboxHref(section, filters, page + 1)}>Older conversations →</Link></div>}
      </Card>
    </>
  );
}
