import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { resolveIntegrationKey } from "@/lib/server/workspace";
import { PageHeader } from "@/components/ui/misc";
import { DiscoverForm } from "@/components/discover/discover-form";

export const metadata = { title: "Find Businesses" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ campaignId?: string }> }) {
  const ctx = await pageContext();
  const [key, campaigns, recent] = await Promise.all([
    resolveIntegrationKey(ctx.workspace.id, "GOOGLE_PLACES").catch(() => null),
    db.campaign.findMany({ where: { workspaceId: ctx.workspace.id, status: { not: "COMPLETED" } }, select: { id: true, name: true } }),
    db.job.findMany({ where: { workspaceId: ctx.workspace.id, type: "DISCOVERY" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, label: true, status: true, progress: true, message: true, error: true, createdAt: true, finishedAt: true, result: true, payload: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Find Businesses" description="Discover local businesses through the official Google Places API. Only permitted fields are requested; emails are never assumed from Google." />
      <DiscoverForm configured={Boolean(key)} canRun={ctx.can("discovery.run")} campaigns={campaigns} recent={JSON.parse(JSON.stringify(recent))} defaultCampaignId={(await searchParams).campaignId ?? ""} />
    </div>
  );
}
