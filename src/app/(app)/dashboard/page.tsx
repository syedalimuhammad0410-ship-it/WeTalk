import Link from "next/link";
import { ArrowRight, Building2, Gauge, Sparkles, Send, MessageSquareReply, ThumbsUp, CalendarCheck, Trophy, Compass, Inbox, CalendarClock, ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { dashboardStats } from "@/lib/server/queries";
import { integrationSummary } from "@/lib/server/workspace";
import { Card, CardHeader, EmptyState, Stat, Badge, Alert } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { formatNumber, greeting, timeAgo } from "@/lib/utils";
import { LEAD_STATUSES, LEAD_STATUS_META } from "@/lib/constants";
import { Greeting } from "@/components/dashboard/greeting";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await pageContext();
  const ws = ctx.workspace.id;
  const [stats, byStatus, activity, integrations] = await Promise.all([
    dashboardStats(ws),
    db.business.groupBy({ by: ["status"], where: { workspaceId: ws, archived: false }, _count: true }),
    db.activityLog.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 12, include: { user: { select: { name: true } }, business: { select: { id: true, name: true } } } }),
    integrationSummary(ws),
  ]);
  const max = Math.max(1, ...byStatus.map((s) => s._count));
  const missing = [
    !integrations.googlePlaces.configured && { label: "Connect Google Places to discover businesses", href: "/settings/integrations" },
    !integrations.anthropic.configured && { label: "Connect Anthropic for AI-enhanced prompts, outreach and replies", href: "/settings/integrations" },
    integrations.email.length === 0 && { label: "Connect an email account to send outreach", href: "/settings/email" },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Greeting name={ctx.user.name.split(" ")[0]!} fallback={greeting()} />
          <p className="mt-1 text-sm text-muted">Here&apos;s what&apos;s happening with your outreach.</p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/leads" variant="outline">View leads</ButtonLink>
          <ButtonLink href="/discover"><Compass className="h-4 w-4" /> Find businesses</ButtonLink>
        </div>
      </div>

      {missing.length > 0 && (
        <Alert tone="info" title="Finish connecting your workspace">
          <ul className="mt-1 space-y-0.5">
            {missing.map((m) => (
              <li key={m.label}><Link href={m.href} className="hover:text-accent hover:underline">{m.label} →</Link></li>
            ))}
          </ul>
        </Alert>
      )}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Businesses found" value={formatNumber(stats.businesses)} icon={<Building2 className="h-4 w-4" />} href="/leads" />
        <Stat label="Websites analyzed" value={formatNumber(stats.analyzed)} icon={<Gauge className="h-4 w-4" />} href="/audits" />
        <Stat label="High-opportunity leads" value={formatNumber(stats.high)} hint="Opportunity score ≥ 70" icon={<Sparkles className="h-4 w-4" />} href="/leads?minOpportunity=70&sort=opportunity" />
        <Stat label="Emails sent" value={formatNumber(stats.sent)} icon={<Send className="h-4 w-4" />} href="/analytics" />
        <Stat label="Responses" value={formatNumber(stats.responses)} icon={<MessageSquareReply className="h-4 w-4" />} href="/inbox" />
        <Stat label="Interested" value={formatNumber(stats.interested)} icon={<ThumbsUp className="h-4 w-4" />} href="/leads?status=INTERESTED,MEETING,PROPOSAL,WON" />
        <Stat label="Meetings" value={formatNumber(stats.meetings)} icon={<CalendarCheck className="h-4 w-4" />} href="/leads?status=MEETING" />
        <Stat label="Customers" value={formatNumber(stats.customers)} icon={<Trophy className="h-4 w-4" />} href="/leads?status=WON" />
      </section>

      {stats.businesses === 0 ? (
        <Card>
          <EmptyState icon={<Building2 className="h-5 w-5" />} title="No businesses yet." description="Search a location and category to discover local businesses, then let WebScout analyse their websites." action={<ButtonLink href="/discover">Find your first businesses</ButtonLink>} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader title="Needs your attention" />
              <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {[
                  { icon: Inbox, label: "AI drafts awaiting approval", n: stats.pendingDrafts, href: "/inbox?section=draft" },
                  { icon: ShieldAlert, label: "Human review required", n: stats.reviewQueue, href: "/inbox?section=review" },
                  { icon: CalendarClock, label: "Follow-ups due", n: stats.dueFollowUps, href: "/follow-ups" },
                ].map((x) => (
                  <Link key={x.label} href={x.href} className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-subtle/60">
                    <x.icon className="h-5 w-5 text-faint group-hover:text-accent" />
                    <div className="min-w-0">
                      <div className="text-xl font-semibold tabular-nums">{x.n}</div>
                      <div className="text-[13px] text-muted">{x.label}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Pipeline" description="Active leads by stage" action={<ButtonLink href="/leads?view=pipeline" variant="ghost" size="sm">Open board <ArrowRight className="h-3.5 w-3.5" /></ButtonLink>} />
              <ul className="space-y-2.5 px-5 py-4">
                {LEAD_STATUSES.map((s) => {
                  const n = byStatus.find((b) => b.status === s)?._count ?? 0;
                  return (
                    <li key={s} className="grid grid-cols-[130px_1fr_40px] items-center gap-3 text-sm sm:grid-cols-[160px_1fr_48px]">
                      <Link href={`/leads?status=${s}`} className="truncate text-muted hover:text-fg">{LEAD_STATUS_META[s].label}</Link>
                      <div className="h-2 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-accent/80" style={{ width: `${(n / max) * 100}%` }} /></div>
                      <span className="text-right tabular-nums">{n}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
          <Card className="h-fit">
            <CardHeader title="Recent activity" />
            <ul className="divide-y divide-border">
              {activity.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">No activity yet.</li>}
              {activity.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <p className="text-sm">{a.summary}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {a.business && <Link href={`/leads/${a.business.id}`} className="font-medium text-muted hover:text-accent">{a.business.name}</Link>}
                    {a.business && " · "}
                    {a.user?.name ?? "System"} · {timeAgo(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {ctx.workspace.isDemo && <p className="text-center text-xs text-faint"><Badge tone="amber">DEMO DATA</Badge> Numbers on this page come from the demo workspace database.</p>}
    </div>
  );
}
