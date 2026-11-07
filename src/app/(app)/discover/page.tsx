import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { resolveIntegrationKey } from "@/lib/server/workspace";
import { zoneSummary } from "@/lib/server/discovery/run";
import { leadAllowance } from "@/lib/server/billing";
import { PageHeader } from "@/components/ui/misc";
import { BusinessFinder } from "@/components/discover/business-finder";

export const metadata = { title: "Find Businesses" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ campaignId?: string }> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  const [key, cred, campaigns, runs] = await Promise.all([
    resolveIntegrationKey(ws, "GOOGLE_PLACES").catch(() => null),
    db.integrationCredential.findUnique({ where: { workspaceId_provider: { workspaceId: ws, provider: "GOOGLE_PLACES" } }, select: { status: true, lastError: true } }),
    db.campaign.findMany({ where: { workspaceId: ws, status: { not: "COMPLETED" } }, select: { id: true, name: true } }),
    db.discoveryRun.findMany({ where: { workspaceId: ws, automationRunId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const runsWithZones = await Promise.all(runs.map(async (r) => ({ ...r, zones: await zoneSummary(r.id) })));
  const a = await leadAllowance(ws);
  const allowance = { planName: a.planName, limit: a.limit, used: a.used };
  return (
    <div>
      <PageHeader title="Find Businesses" description="Search a radius of up to 500 km or a whole city, region, province or country. Only official APIs and open data are used; emails are never guessed." />
      <BusinessFinder googleConfigured={Boolean(key)} googleError={cred?.status === "ERROR" ? (cred.lastError ?? "Google refused the request.") : null} canRun={ctx.can("discovery.run")} campaigns={campaigns} runs={JSON.parse(JSON.stringify(runsWithZones))} defaultCampaignId={sp.campaignId ?? ""} allowance={allowance} />
    </div>
  );
}
