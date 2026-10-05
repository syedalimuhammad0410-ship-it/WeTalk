import Link from "next/link";
import { Gauge } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { Card, EmptyState, PageHeader, ScoreBadge, Badge } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { WebsiteBadge } from "@/components/leads/status-badge";
import { AuditAllButton } from "@/components/leads/audit-all";
import { SCORE_CATEGORIES, SCORE_CATEGORY_LABEL } from "@/lib/constants";

import { RelTime } from "@/components/ui/time";

export const metadata = { title: "Website Audits" };

export default async function AuditsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await pageContext();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const ws = ctx.workspace.id;
  const [audits, total, unaudited, byClass] = await Promise.all([
    db.websiteAudit.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 40, take: 40, include: { business: { select: { id: true, name: true, city: true, opportunityScore: true } } } }),
    db.websiteAudit.count({ where: { workspaceId: ws } }),
    db.business.findMany({ where: { workspaceId: ws, archived: false, websiteClass: null }, select: { id: true }, take: 1000 }),
    db.business.groupBy({ by: ["websiteClass"], where: { workspaceId: ws, archived: false, websiteClass: { not: null } }, _count: true }),
  ]);
  return (
    <div>
      <PageHeader title="Website Audits" description="Explainable audits across design, performance, mobile, content, conversion, SEO, trust and functionality." actions={ctx.can("audits.run") && unaudited.length > 0 && <AuditAllButton ids={unaudited.map((u) => u.id)} />} />
      {byClass.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {byClass.map((c) => <Link key={c.websiteClass} href={`/leads?websiteClass=${c.websiteClass}`}><WebsiteBadge websiteClass={c.websiteClass} /> <span className="text-xs tabular-nums text-muted">{c._count}</span></Link>)}
        </div>
      )}
      <Card className="overflow-hidden">
        {audits.length === 0 ? (
          <EmptyState icon={<Gauge className="h-5 w-5" />} title="No audits yet" description="Audits run automatically after discovery, or from any lead's page." action={<ButtonLink href="/leads">Go to leads</ButtonLink>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[900px]">
              <thead><tr><th>Business</th><th>Result</th><th className="text-right">Overall</th>{SCORE_CATEGORIES.map((c) => <th key={c} className="text-right">{SCORE_CATEGORY_LABEL[c].slice(0, 5)}</th>)}<th className="text-right">Opp.</th><th>When</th></tr></thead>
              <tbody>
                {audits.map((a) => {
                  const s = (a.scores ?? {}) as Record<string, number>;
                  return (
                    <tr key={a.id}>
                      <td><Link href={`/leads/${a.business.id}?tab=audit`} className="font-medium hover:text-accent">{a.business.name}</Link><div className="text-xs text-muted">{a.business.city ?? ""}</div></td>
                      <td>{a.status === "COMPLETED" ? <WebsiteBadge websiteClass={a.classification} websiteStatus={a.websiteStatus} /> : <Badge tone={a.status === "FAILED" ? "red" : "blue"}>{a.status.toLowerCase()}</Badge>}</td>
                      <td className="text-right"><ScoreBadge score={a.overallScore} /></td>
                      {SCORE_CATEGORIES.map((c) => <td key={c} className="text-right text-xs"><ScoreBadge score={s[c]} /></td>)}
                      <td className="text-right"><ScoreBadge score={a.business.opportunityScore} /></td>
                      <td className="whitespace-nowrap text-xs text-muted"><RelTime d={a.createdAt} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 40 && (
          <div className="flex justify-between border-t border-border px-4 py-3 text-sm text-muted">
            <span>{total} audits</span>
            <span className="flex gap-3">{page > 1 && <Link href={`/audits?page=${page - 1}`} className="text-accent">Previous</Link>}{page * 40 < total && <Link href={`/audits?page=${page + 1}`} className="text-accent">Next</Link>}</span>
          </div>
        )}
      </Card>
    </div>
  );
}
