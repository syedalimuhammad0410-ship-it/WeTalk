import Link from "next/link";
import { Megaphone } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { Card, EmptyState, PageHeader, Badge } from "@/components/ui/misc";
import { NewCampaignButton } from "@/components/campaigns/campaign-form";
import { campaignStats } from "@/lib/server/campaigns";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const ctx = await pageContext();
  const campaigns = await db.campaign.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { leads: true } } } });
  const stats = await Promise.all(campaigns.map((c) => campaignStats(ctx.workspace.id, c.id)));
  const templates = await db.emailTemplate.findMany({ where: { workspaceId: ctx.workspace.id, kind: "OUTREACH" }, select: { id: true, name: true } });
  return (
    <div>
      <PageHeader title="Campaigns" description="Group businesses, templates, prompt strategy and follow-up rules — and measure what works." actions={ctx.can("campaigns.manage") && <NewCampaignButton templates={templates} />} />
      {campaigns.length === 0 ? (
        <Card><EmptyState icon={<Megaphone className="h-5 w-5" />} title="No campaigns yet" description="Example: “Mississauga Restaurants October 2026”." action={ctx.can("campaigns.manage") && <NewCampaignButton templates={templates} />} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((c, i) => {
            const s = stats[i]!;
            return (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="card group p-5 transition-colors hover:border-faint/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="truncate font-semibold group-hover:text-accent">{c.name}</div><div className="truncate text-xs text-muted">{c.description || "No description"}</div></div>
                  <Badge tone={{ DRAFT: "zinc", ACTIVE: "green", PAUSED: "amber", COMPLETED: "slate" }[c.status] as "zinc"}>{c.status.toLowerCase()}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                  {[["Leads", c._count.leads], ["Contacted", s.contacted], ["Responses", s.responses], ["Won", s.won]].map(([l, v]) => <div key={l as string} className="rounded-lg bg-subtle py-2"><dd className="text-lg font-semibold tabular-nums">{v}</dd><dt className="text-[11px] text-muted">{l}</dt></div>)}
                </dl>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
