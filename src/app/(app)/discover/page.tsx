import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { resolveIntegrationKey } from "@/lib/server/workspace";
import { zoneSummary } from "@/lib/server/discovery/run";
import { PageHeader } from "@/components/ui/misc";
import { DiscoverForm } from "@/components/discover/discover-form";
import { RegionDiscovery } from "@/components/discover/region-discovery";

export const metadata = { title: "Find Businesses" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ campaignId?: string; mode?: string }> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  const [key, campaigns, recent, runs] = await Promise.all([
    resolveIntegrationKey(ws, "GOOGLE_PLACES").catch(() => null),
    db.campaign.findMany({ where: { workspaceId: ws, status: { not: "COMPLETED" } }, select: { id: true, name: true } }),
    db.job.findMany({ where: { workspaceId: ws, type: "DISCOVERY" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, label: true, status: true, progress: true, message: true, error: true, createdAt: true, finishedAt: true, result: true, payload: true } }),
    db.discoveryRun.findMany({ where: { workspaceId: ws, automationRunId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const runsWithZones = await Promise.all(runs.map(async (r) => ({ ...r, zones: await zoneSummary(r.id) })));
  return (
    <div className="space-y-6">
      <PageHeader title="Find Businesses" description="Search nearby, or across whole cities, regions, provinces and countries. Only official APIs and open data are used; emails are never assumed." />
      <RegionDiscovery googleConfigured={Boolean(key)} canRun={ctx.can("discovery.run")} campaigns={campaigns} runs={JSON.parse(JSON.stringify(runsWithZones))} defaultOpen={sp.mode === "region"} />
      <DiscoverForm configured={Boolean(key)} canRun={ctx.can("discovery.run")} campaigns={campaigns} recent={JSON.parse(JSON.stringify(recent))} defaultCampaignId={sp.campaignId ?? ""} />
    </div>
  );
}
