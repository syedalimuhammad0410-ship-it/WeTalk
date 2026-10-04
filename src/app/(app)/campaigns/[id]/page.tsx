import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { campaignStats } from "@/lib/server/campaigns";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const c = await db.campaign.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!c) notFound();
  const [stats, leads, templates] = await Promise.all([
    campaignStats(ctx.workspace.id, id),
    db.business.findMany({ where: { workspaceId: ctx.workspace.id, campaignLeads: { some: { campaignId: id } } }, orderBy: { opportunityScore: { sort: "desc", nulls: "last" } }, take: 300, select: { id: true, name: true, city: true, status: true, opportunityScore: true, websiteClass: true, websiteStatus: true, email: true, doNotContact: true } }),
    db.emailTemplate.findMany({ where: { workspaceId: ctx.workspace.id, kind: "OUTREACH" }, select: { id: true, name: true } }),
  ]);
  return <CampaignDetail campaign={JSON.parse(JSON.stringify(c))} stats={stats} leads={JSON.parse(JSON.stringify(leads))} templates={templates} perms={{ manage: ctx.can("campaigns.manage"), del: ctx.can("leads.delete"), send: ctx.can("emails.send") }} />;
}
