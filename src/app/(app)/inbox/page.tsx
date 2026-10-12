import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { categoryCounts, inboxWhere, parseInboxFilters, sectionCounts } from "@/lib/server/inbox";
import { INBOX_SECTIONS, type InboxSection } from "@/lib/constants";
import { PageHeader } from "@/components/ui/misc";
import { InboxList } from "@/components/inbox/inbox-list";
import { ReviewQueue } from "@/components/inbox/review-queue";
import { InboxActions } from "@/components/inbox/inbox-actions";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const section = (INBOX_SECTIONS.some((s) => s.id === sp.section) ? sp.section : "all") as InboxSection;
  const page = Math.max(1, Number(sp.page) || 1);
  const ws = ctx.workspace.id;
  const filters = parseInboxFilters(sp);
  const [counts, catCounts, conversations, accounts] = await Promise.all([
    sectionCounts(ws),
    categoryCounts(ws),
    db.conversation.findMany({
      where: inboxWhere(ws, section, filters),
      orderBy: { lastMessageAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
      include: {
        business: { select: { id: true, name: true, status: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { bodyText: true, direction: true } },
        drafts: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.emailAccount.findMany({ where: { workspaceId: ws }, select: { id: true, provider: true } }),
  ]);
  const members = await db.user.findMany({ where: { id: { in: conversations.map((c) => c.assignedToId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const reviewItems = section === "review"
    ? await db.conversation.findMany({
        where: inboxWhere(ws, "review", filters),
        orderBy: { lastMessageAt: "desc" },
        take: 30,
        include: { business: { select: { id: true, name: true } }, messages: { where: { direction: "INBOUND" }, orderBy: { createdAt: "desc" }, take: 1 }, drafts: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 } },
      })
    : [];
  return (
    <div>
      <PageHeader title="Inbox" description="Replies are matched to the right lead and conversation, classified, and drafted — you stay in control." actions={<InboxActions accounts={accounts} />} />
      {section === "review" ? (
        <ReviewQueue filters={filters} categoryCounts={catCounts} counts={counts} items={JSON.parse(JSON.stringify(reviewItems))} perms={{ approve: ctx.can("drafts.approve"), send: ctx.can("emails.send") }} />
      ) : (
        <InboxList section={section} counts={counts} page={page} filters={filters} categoryCounts={catCounts} conversations={JSON.parse(JSON.stringify(conversations.map((c) => ({ ...c, assignedTo: members.find((m) => m.id === c.assignedToId)?.name ?? null }))))} />
      )}
    </div>
  );
}
