import { pageContext } from "@/lib/server/page";
import { analytics, responseStats } from "@/lib/server/queries";
import { PageHeader } from "@/components/ui/misc";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { getPlaybook } from "@/lib/server/intel/playbooks";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; tab?: string }> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const days = { "7": 7, "30": 30, "90": 90, "365": 365 }[sp.range ?? "30"] ?? 30;
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : new Date();
  const from = sp.from ? new Date(`${sp.from}T00:00:00`) : new Date(to.getTime() - (days - 1) * 86400_000);
  const [a, r] = await Promise.all([analytics(ctx.workspace.id, from, to), responseStats(ctx.workspace.id)]);
  a.byCategory = a.byCategory.map((c) => ({ ...c, category: getPlaybook(c.category).label }));
  return (
    <div>
      <PageHeader title="Analytics" description="Every number is computed from your workspace database for the selected period." />
      <AnalyticsView data={JSON.parse(JSON.stringify(a))} responses={r} range={sp.from ? "custom" : (sp.range ?? "30")} from={from.toISOString().slice(0, 10)} to={to.toISOString().slice(0, 10)} initialTab={sp.tab === "responses" ? "responses" : "overview"} />
    </div>
  );
}
