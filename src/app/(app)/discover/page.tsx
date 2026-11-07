import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { resolveIntegrationKey } from "@/lib/server/workspace";
import { zoneSummary } from "@/lib/server/discovery/run";
import { PageHeader } from "@/components/ui/misc";
import { BusinessFinder } from "@/components/discover/business-finder";

export const metadata = { title: "Find Businesses" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ campaignId?: string }> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  const [key, campaigns, runs] = await Promise.all([
    resolveIntegrationKey(ws, "GOOGLE_PLACES").catch(() => null),
    db.campaign.findMany({ where: { workspaceId: ws, status: { not: "COMPLETED" } }, select: { id: true, name: true } }),
    db.discoveryRun.findMany({ where: { workspaceId: ws, automationRunId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const runsWithZones = await Promise.all(runs.map(async (r) => ({ ...r, zones: await zoneSummary(r.id) })));
  return (
    <div>
      <PageHeader title="Find Businesses" description="Search a radius of up to 500 km or a whole city, region, province or country. Only official APIs and open data are used; emails are never guessed." />
      <BusinessFinder googleConfigured={Boolean(key)} canRun={ctx.can("discovery.run")} campaigns={campaigns} runs={JSON.parse(JSON.stringify(runsWithZones))} defaultCampaignId={sp.campaignId ?? ""} />
    </div>
  );
}
