import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { getPlaybook, PLAYBOOKS } from "@/lib/server/intel/playbooks";
import { classifyBusinessType } from "@/lib/server/intel/classify-type";
import { FEATURES } from "@/lib/server/intel/features";
import { checkSendAllowed } from "@/lib/server/email/send";
import { describeError } from "@/lib/server/errors";
import { LeadDetail } from "@/components/leads/lead-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUnique({ where: { id }, select: { name: true } });
  return { title: b?.name ?? "Lead" };
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const { tab } = await searchParams;
  const ws = ctx.workspace.id;
  const business = await db.business.findFirst({
    where: { id, workspaceId: ws },
    include: { contacts: true, tags: { include: { tag: true } }, assignedTo: { select: { id: true, name: true } }, campaignLeads: { include: { campaign: { select: { id: true, name: true } } } } },
  });
  if (!business) notFound();
  const [audit, opportunity, prompt, draft, messages, conversations, followUps, notes, activity, statusHistory, members, templates, campaigns, allTags, emailAccount] = await Promise.all([
    db.websiteAudit.findFirst({ where: { businessId: id }, orderBy: { createdAt: "desc" }, include: { findings: true } }),
    db.opportunity.findFirst({ where: { businessId: id }, orderBy: { createdAt: "desc" } }),
    db.generatedPrompt.findFirst({ where: { businessId: id }, orderBy: { updatedAt: "desc" }, include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, qualityScore: true, wordCount: true, createdAt: true, generator: true, content: true } } } }),
    db.emailMessage.findFirst({ where: { businessId: id, status: "DRAFT", kind: "OUTREACH" } }),
    db.emailMessage.findMany({ where: { businessId: id, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, direction: true, status: true, kind: true, subject: true, toAddress: true, fromAddress: true, sentAt: true, receivedAt: true, createdAt: true, error: true, conversationId: true, intent: true, aiGenerated: true } }),
    db.conversation.findMany({ where: { businessId: id }, orderBy: { lastMessageAt: "desc" }, select: { id: true, subject: true, counterpartEmail: true, lastMessageAt: true, lastIntent: true, needsHumanReview: true, unread: true } }),
    db.followUp.findMany({ where: { businessId: id }, orderBy: { scheduledFor: "asc" } }),
    db.note.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, name: true } } } }),
    db.activityLog.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true } } } }),
    db.leadStatusChange.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" } }),
    db.workspaceMember.findMany({ where: { workspaceId: ws }, select: { user: { select: { id: true, name: true } } } }),
    db.emailTemplate.findMany({ where: { workspaceId: ws, kind: "OUTREACH" }, select: { id: true, name: true } }),
    db.campaign.findMany({ where: { workspaceId: ws }, select: { id: true, name: true } }),
    db.tag.findMany({ where: { workspaceId: ws }, select: { name: true } }),
    db.emailAccount.findFirst({ where: { workspaceId: ws, isDefault: true }, select: { provider: true, emailAddress: true } }),
  ]);
  const compliance = await db.complianceSettings.findUnique({ where: { workspaceId: ws }, select: { dataRetentionDays: true } });
  const staleDays = business.source === "GOOGLE_PLACES" && business.sourceFetchedAt && compliance?.dataRetentionDays ? Math.floor((Date.now() - business.sourceFetchedAt.getTime()) / 86400_000) : 0;
  const listingStale = compliance?.dataRetentionDays ? staleDays > compliance.dataRetentionDays : false;
  const typeInfo = classifyBusinessType({ category: business.category, name: business.name });
  const playbook = getPlaybook(business.businessType ?? typeInfo.playbook.id);
  let sendBlocker: string | null = null;
  if (business.email) {
    try {
      await checkSendAllowed({ workspaceId: ws, to: business.email, businessId: id, kind: "OUTREACH" });
    } catch (e) {
      sendBlocker = describeError(e);
    }
  }
  const data = {
    business, audit, opportunity, draft, messages, conversations, followUps, notes, activity, statusHistory,
    prompt: prompt ? { id: prompt.id, title: prompt.title, currentVersion: prompt.currentVersion, qualityScore: prompt.qualityScore, updatedAt: prompt.updatedAt, latest: prompt.versions[0] ? { ...prompt.versions[0], content: prompt.versions[0].content.slice(0, 1800) } : null } : null,
    members: members.map((m) => m.user), templates, campaigns, allTags: allTags.map((t) => t.name),
    playbook: { id: playbook.id, label: playbook.label, primaryConversion: playbook.primaryConversion, primaryGoal: playbook.primaryGoal, features: playbook.features.map((f) => ({ ...f, name: FEATURES[f.key]!.name })) },
    typeEvidence: typeInfo.evidence,
    businessTypes: PLAYBOOKS.map((p) => ({ id: p.id, label: p.label })).sort((a, b) => a.label.localeCompare(b.label)),
    allFeatures: Object.values(FEATURES).map((f) => ({ key: f.key, name: f.name })),
    emailAccount,
    sendBlocker,
    listingStale: listingStale ? staleDays : null,
  };
  return (
    <LeadDetail
      data={JSON.parse(JSON.stringify(data))}
      initialTab={tab ?? "overview"}
      perms={{ edit: ctx.can("leads.edit"), status: ctx.can("leads.changeStatus"), del: ctx.can("leads.delete"), audit: ctx.can("audits.run"), prompt: ctx.can("prompts.edit"), compose: ctx.can("emails.compose"), send: ctx.can("emails.send"), reverseDnc: ctx.can("doNotContact.reverse") }}
      currentUserId={ctx.user.id}
    />
  );
}
