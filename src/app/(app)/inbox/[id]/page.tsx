import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { getPlaybook } from "@/lib/server/intel/playbooks";
import { Conversation } from "@/components/inbox/conversation";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const conv = await db.conversation.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: {
      business: { include: { tags: { include: { tag: true } } } },
      emailAccount: { select: { provider: true, emailAddress: true } },
      messages: { where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "asc" } },
      drafts: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!conv) notFound();
  const assignee = conv.assignedToId ? await db.user.findUnique({ where: { id: conv.assignedToId }, select: { name: true } }) : null;
  const followUps = conv.businessId ? await db.followUp.findMany({ where: { businessId: conv.businessId, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, orderBy: { scheduledFor: "asc" } }) : [];
  const leadOptions = conv.businessId ? [] : await db.business.findMany({ where: { workspaceId: ctx.workspace.id, archived: false }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, city: true } });
  return (
    <Conversation
      conv={JSON.parse(JSON.stringify({ ...conv, assignee: assignee?.name ?? null, businessTypeLabel: conv.business ? getPlaybook(conv.business.businessType).label : null }))}
      followUps={JSON.parse(JSON.stringify(followUps))}
      leadOptions={leadOptions}
      perms={{ approve: ctx.can("drafts.approve"), send: ctx.can("emails.send"), compose: ctx.can("emails.compose"), edit: ctx.can("leads.edit") }}
    />
  );
}
