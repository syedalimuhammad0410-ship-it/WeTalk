import { notFound } from "next/navigation";
import { pageContext } from "@/lib/server/page";
import { getAutoProspect } from "@/lib/server/automation/autoprospect";
import { RunDashboard } from "@/components/autoprospect/run-dashboard";

export const metadata = { title: "AutoProspect run" };

export default async function AutoProspectRunPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const data = await getAutoProspect(ctx.workspace.id, id).catch(() => null);
  if (!data) notFound();
  return <RunDashboard initial={JSON.parse(JSON.stringify(data))} canControl={ctx.can("campaigns.manage")} />;
}
