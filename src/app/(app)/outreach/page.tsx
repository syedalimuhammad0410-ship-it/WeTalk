import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { getSettings } from "@/lib/server/workspace";
import { outreachQueue, outreachStats } from "@/lib/server/outreach";
import { PLAYBOOKS } from "@/lib/server/intel/playbooks";
import { PageHeader } from "@/components/ui/misc";
import { OutreachView } from "@/components/outreach/outreach-view";

export const metadata = { title: "Outreach" };

export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const f = { campaignId: sp.campaignId || undefined, city: sp.city || undefined, businessType: sp.businessType || undefined, eligibility: sp.eligibility || undefined, page: Number(sp.page) || 1 };
  const ws = ctx.workspace.id;
  const [stats, queue, campaigns, settings] = await Promise.all([
    outreachStats(ws, f),
    outreachQueue(ws, f),
    db.campaign.findMany({ where: { workspaceId: ws }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    getSettings(ws),
  ]);
  return (
    <div>
      <PageHeader title="Outreach" description="Every personalised draft with its recipient, evidence of the consent basis, and the full email — approve before anything is sent." />
      <OutreachView
        stats={stats}
        queue={JSON.parse(JSON.stringify(queue))}
        filters={f}
        campaigns={campaigns}
        types={PLAYBOOKS.map((p) => ({ id: p.id, label: p.label }))}
        mode={settings.automation.outreachMode}
        perms={{ approve: ctx.can("drafts.approve") && ctx.can("emails.send") }}
      />
    </div>
  );
}
