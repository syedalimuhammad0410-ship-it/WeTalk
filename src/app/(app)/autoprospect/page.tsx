import Link from "next/link";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { getSettings } from "@/lib/server/workspace";
import { providerOverview } from "@/lib/server/discovery/providers";
import { listAutoProspects } from "@/lib/server/automation/autoprospect";
import { Card, CardHeader, Badge, PageHeader } from "@/components/ui/misc";
import { RelTime } from "@/components/ui/time";
import { AutoProspectForm } from "@/components/autoprospect/autoprospect-form";

export const metadata = { title: "AutoProspect" };

const STATUS_TONE: Record<string, "green" | "amber" | "slate" | "red" | "blue" | "zinc"> = { QUEUED: "blue", RUNNING: "blue", PAUSED: "amber", COMPLETED: "green", CANCELLED: "zinc", FAILED: "red" };

export default async function AutoProspectPage() {
  const ctx = await pageContext();
  const ws = ctx.workspace.id;
  const [settings, providers, runs, templates] = await Promise.all([
    getSettings(ws),
    providerOverview(ws),
    listAutoProspects(ws),
    db.emailTemplate.findMany({ where: { workspaceId: ws, kind: "OUTREACH" }, select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader title="AutoProspect" description="From search to sales pipeline: one button runs discovery, contact research, website analysis, prompts and personalised drafts — with human oversight before anything is sent." />
      <AutoProspectForm templates={templates} providers={JSON.parse(JSON.stringify(providers))} paused={settings.automation.automationPaused} outreachMode={settings.automation.outreachMode} canStart={ctx.can("discovery.run") && ctx.can("campaigns.manage")} />
      <Card className="mt-6">
        <CardHeader title="Automation history" description="Every run keeps its results, checkpoints and errors." />
        {runs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No automated prospecting runs yet.</p> : (
          <ul className="divide-y divide-border">
            {runs.map((r) => {
              const c = (r.counters ?? {}) as Record<string, number>;
              return (
                <li key={r.id}>
                  <Link href={`/autoprospect/${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-subtle/60">
                    <span className="min-w-0 flex-1 font-medium">{r.name}</span>
                    <Badge tone={STATUS_TONE[r.status] ?? "zinc"}>{r.status.toLowerCase()}</Badge>
                    <span className="text-muted tabular-nums">{c.discovered ?? 0} found · {c.emailsDiscovered ?? 0} emails · {c.draftsCreated ?? 0} drafts</span>
                    <span className="text-xs text-faint"><RelTime d={r.createdAt} /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
