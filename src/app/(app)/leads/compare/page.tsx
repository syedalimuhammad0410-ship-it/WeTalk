import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { getPlaybook } from "@/lib/server/intel/playbooks";
import { Card, PageHeader, ScoreBadge, EmptyState } from "@/components/ui/misc";
import { StatusBadge, WebsiteBadge } from "@/components/leads/status-badge";
import { SCORE_CATEGORIES, SCORE_CATEGORY_LABEL } from "@/lib/constants";

export const metadata = { title: "Compare leads" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const ctx = await pageContext();
  const ids = ((await searchParams).ids ?? "").split(",").filter(Boolean).slice(0, 4);
  const leads = await db.business.findMany({ where: { workspaceId: ctx.workspace.id, id: { in: ids } }, include: { opportunities: { orderBy: { createdAt: "desc" }, take: 1 }, audits: { where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (leads.length < 2) return <Card><EmptyState title="Select 2–4 leads to compare" description="Choose leads in the Leads table and pick More → Compare." /></Card>;
  const rows: { label: string; render: (l: (typeof leads)[number]) => React.ReactNode }[] = [
    { label: "Opportunity", render: (l) => <span className="text-lg"><ScoreBadge score={l.opportunityScore} /></span> },
    { label: "Website score", render: (l) => <ScoreBadge score={l.websiteScore} /> },
    { label: "Website", render: (l) => <div className="space-y-1"><WebsiteBadge websiteClass={l.websiteClass} websiteStatus={l.websiteStatus} />{l.website && <div className="truncate text-xs text-muted">{l.websiteDomain ?? l.website}</div>}</div> },
    { label: "Business type", render: (l) => getPlaybook(l.businessType).label },
    { label: "Location", render: (l) => l.city ?? l.address ?? <span className="text-faint">Not found</span> },
    { label: "Contact", render: (l) => <div className="text-xs">{l.email ?? <span className="text-faint">No email</span>}<br />{l.phone ?? <span className="text-faint">No phone</span>}</div> },
    { label: "Status", render: (l) => <StatusBadge status={l.status} /> },
    { label: "Missing features", render: (l) => { const f = ((l.opportunities[0]?.recommendedFeatures ?? []) as { name: string; status: string; priority: string }[]).filter((x) => x.status === "missing" && x.priority !== "optional"); return f.length ? <ul className="space-y-0.5 text-xs">{f.map((x) => <li key={x.name}>• {x.name}</li>)}</ul> : <span className="text-faint">—</span>; } },
    { label: "Top reasons", render: (l) => <ul className="space-y-0.5 text-xs text-muted">{((l.opportunities[0]?.reasons ?? []) as { label: string; points: number }[]).filter((r) => r.points > 0).slice(0, 3).map((r) => <li key={r.label}>+{r.points} {r.label}</li>)}</ul> },
    ...SCORE_CATEGORIES.map((c) => ({ label: SCORE_CATEGORY_LABEL[c], render: (l: (typeof leads)[number]) => <ScoreBadge score={((l.audits[0]?.scores ?? {}) as Record<string, number>)[c]} /> })),
  ];
  return (
    <div>
      <Link href="/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Leads</Link>
      <PageHeader title="Compare leads" description="Side-by-side website, opportunity and contact comparison." />
      <Card className="overflow-x-auto">
        <table className="table-base min-w-[640px]">
          <thead><tr><th className="w-40" />{leads.map((l) => <th key={l.id} className="normal-case tracking-normal"><Link href={`/leads/${l.id}`} className="text-sm font-semibold text-fg hover:text-accent">{l.name}</Link></th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label}><td className="font-medium text-muted">{r.label}</td>{leads.map((l) => <td key={l.id}>{r.render(l)}</td>)}</tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}
