"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw, XCircle } from "lucide-react";
import { Card, CardHeader, Badge, Stat } from "../ui/misc";
import { Button } from "../ui/button";
import { Tabs } from "../ui/tabs";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/utils";

type Tab = "health" | "config" | "jobs" | "logs" | "usage" | "users";

export function AdminView({ data }: { data: any }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("health");
  const [health, setHealth] = useState<any[]>(data.health);
  const [testing, setTesting] = useState(false);
  const icon = (s: string) => (s === "ok" ? <CheckCircle2 className="h-5 w-5 text-success" /> : s === "error" ? <XCircle className="h-5 w-5 text-danger" /> : s === "warning" ? <AlertTriangle className="h-5 w-5 text-warning" /> : <CircleDashed className="h-5 w-5 text-faint" />);
  return (
    <div className="space-y-5">
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "health", label: "System health" }, { id: "config", label: "Configuration" }, { id: "jobs", label: "Jobs", count: data.failedJobs.length || undefined }, { id: "logs", label: "Logs" }, { id: "usage", label: "Usage" }, { id: "users", label: data.isSystemAdmin ? "Users & workspaces" : "Users" }]} />
      {tab === "health" && (
        <Card>
          <CardHeader title="System health" action={<Button size="sm" variant="outline" loading={testing} loadingText="Testing…" onClick={async () => { setTesting(true); try { setHealth(await apiFetch("/api/admin/health?live=1")); } finally { setTesting(false); } }}><RefreshCw className="h-4 w-4" /> Run live checks</Button>} />
          <ul className="divide-y divide-border">
            {health.map((h) => (
              <li key={h.name} className="flex items-start gap-3 px-5 py-4">
                {icon(h.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{h.name}<Badge tone={h.status === "ok" ? "green" : h.status === "error" ? "red" : h.status === "warning" ? "amber" : "zinc"}>{h.status === "ok" ? "Connected" : h.status === "off" ? "Not connected" : h.status === "warning" ? "Attention" : "Error"}</Badge></div>
                  <p className="text-[13px] text-muted">{h.detail}</p>
                  {h.action && <p className="mt-0.5 text-[13px] text-accent">{h.href ? <Link href={h.href} className="hover:underline">{h.action} →</Link> : h.action}</p>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === "config" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader title="API configuration" action={<Link href="/settings/integrations" className="text-sm text-accent">Manage</Link>} />
            <dl className="space-y-2 p-5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Anthropic</dt><dd>{data.integrations.anthropic.configured ? `${data.integrations.anthropic.source} key ${data.integrations.anthropic.hint ?? ""}` : "Not connected"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Google Places</dt><dd>{data.integrations.googlePlaces.configured ? `${data.integrations.googlePlaces.source} key ${data.integrations.googlePlaces.hint ?? ""}` : "Not connected"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Google OAuth (sign-in/Gmail)</dt><dd>{data.integrations.googleOAuthAvailable ? "Configured" : "Not configured"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Email sandbox</dt><dd>{data.integrations.sandboxAvailable ? "Allowed" : "Disabled"}</dd></div>
            </dl>
          </Card>
          <Card><CardHeader title="Email connections" action={<Link href="/settings/email" className="text-sm text-accent">Manage</Link>} />
            <ul className="divide-y divide-border">{data.integrations.email.length === 0 && <li className="px-5 py-4 text-sm text-muted">None</li>}{data.integrations.email.map((e: any) => <li key={e.id} className="flex justify-between px-5 py-3 text-sm"><span>{e.emailAddress}</span><Badge tone={e.status === "ERROR" ? "red" : "green"}>{e.provider} · {e.status.toLowerCase()}</Badge></li>)}</ul>
          </Card>
          <Card><CardHeader title="Automation" action={<Link href="/settings/automation" className="text-sm text-accent">Manage</Link>} />
            <dl className="grid grid-cols-2 gap-2 p-5 text-sm">
              {["responseMode", "aiModel", "automaticReplies", "automaticFollowUps", "autoReplyMinConfidence", "aiResponseDrafting"].map((k) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{String(data.automation[k])}</dd></div>)}
            </dl>
          </Card>
          <Card><CardHeader title="Compliance limits" action={<Link href="/settings/compliance" className="text-sm text-accent">Manage</Link>} />
            <dl className="grid grid-cols-2 gap-2 p-5 text-sm">
              {["maxEmailsPerDay", "maxEmailsPerHour", "minMinutesBetweenSends", "maxFollowUps", "includeUnsubscribeFooter", "aiDisclosureEnabled"].map((k) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{String(data.compliance[k])}</dd></div>)}
            </dl>
          </Card>
        </div>
      )}
      {tab === "jobs" && (
        <div className="space-y-5">
          {data.failedJobs.length > 0 && (
            <Card><CardHeader title="Failed jobs" />
              <ul className="divide-y divide-border">{data.failedJobs.map((j: any) => <li key={j.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="text-sm font-medium">{j.label}</div><div className="text-xs text-danger">{j.error}</div><div className="text-xs text-faint">{formatDateTime(j.createdAt)}</div></div><Button size="sm" variant="outline" onClick={async () => { try { await apiFetch(`/api/jobs/${j.id}/retry`, { body: {} }); toast.success("Retry queued"); router.refresh(); } catch (e) { toast.error((e as Error).message); } }}>Retry</Button></li>)}</ul>
            </Card>
          )}
          <Card><CardHeader title="Recent jobs" />
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Job</th><th>Status</th><th>Progress</th><th>Started</th><th>Finished</th></tr></thead><tbody>
              {data.jobs.map((j: any) => <tr key={j.id}><td>{j.label}<div className="text-xs text-muted">{j.type}</div></td><td><Badge tone={{ COMPLETED: "green", FAILED: "red", RUNNING: "blue", QUEUED: "slate", CANCELLED: "zinc" }[j.status as string] as any}>{j.status.toLowerCase()}</Badge></td><td className="tabular-nums">{j.progress}%</td><td className="text-xs">{timeAgo(j.createdAt)}</td><td className="text-xs">{j.finishedAt ? timeAgo(j.finishedAt) : "—"}</td></tr>)}
            </tbody></table></div>
          </Card>
        </div>
      )}
      {tab === "logs" && (
        <Card><CardHeader title="Activity log" description="Timestamp, user, action and lead for important actions." />
          <div className="overflow-x-auto"><table className="table-base min-w-[640px]"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Lead</th></tr></thead><tbody>
            {data.logs.map((l: any) => <tr key={l.id}><td className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</td><td className="text-xs">{l.user?.name ?? "System"}</td><td><div className="text-sm">{l.summary}</div><div className="font-mono text-[11px] text-faint">{l.action}</div></td><td className="text-xs">{l.business ? <Link href={`/leads/${l.business.id}`} className="text-accent">{l.business.name}</Link> : "—"}</td></tr>)}
          </tbody></table></div>
        </Card>
      )}
      {tab === "usage" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Leads" value={formatNumber(data.usage.leads)} /><Stat label="Audits" value={formatNumber(data.usage.audits)} /><Stat label="Prompts" value={formatNumber(data.usage.prompts)} /><Stat label="Conversations" value={formatNumber(data.usage.conversations)} /></div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader title="AI usage (30 days)" />
              <table className="table-base"><thead><tr><th>Feature</th><th className="text-right">Calls</th><th className="text-right">Input tok.</th><th className="text-right">Output tok.</th></tr></thead><tbody>
                {data.aiUsage.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">No AI calls yet.</td></tr>}
                {data.aiUsage.map((u: any) => <tr key={u.feature + u.success}><td>{u.feature}{!u.success && <Badge tone="red" className="ml-2">failed</Badge>}</td><td className="text-right tabular-nums">{u._count}</td><td className="text-right tabular-nums">{formatNumber(u._sum.inputTokens)}</td><td className="text-right tabular-nums">{formatNumber(u._sum.outputTokens)}</td></tr>)}
              </tbody></table>
            </Card>
            <Card><CardHeader title="Email activity (30 days)" />
              <table className="table-base"><thead><tr><th>Direction</th><th>Status</th><th className="text-right">Messages</th></tr></thead><tbody>
                {data.emailActivity.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted">No email activity yet.</td></tr>}
                {data.emailActivity.map((e: any) => <tr key={e.direction + e.status}><td>{e.direction.toLowerCase()}</td><td>{e.status.toLowerCase()}</td><td className="text-right tabular-nums">{e._count}</td></tr>)}
              </tbody></table>
            </Card>
          </div>
        </div>
      )}
      {tab === "users" && (
        <div className="space-y-5">
          <Card><CardHeader title="Workspace users" action={<Link href="/settings/users" className="text-sm text-accent">Manage</Link>} />
            <ul className="divide-y divide-border">{data.members.map((m: any) => <li key={m.id} className="flex justify-between px-5 py-3 text-sm"><span>{m.user.name} <span className="text-muted">{m.user.email}</span></span><Badge tone="slate">{m.role.toLowerCase()}</Badge></li>)}</ul>
          </Card>
          {data.isSystemAdmin && (
            <Card><CardHeader title="All workspaces (system admin)" />
              <table className="table-base"><thead><tr><th>Workspace</th><th className="text-right">Members</th><th className="text-right">Leads</th><th>Created</th></tr></thead><tbody>
                {data.allWorkspaces.map((w: any) => <tr key={w.id}><td>{w.name}{w.isDemo && <Badge tone="amber" className="ml-2">DEMO</Badge>}</td><td className="text-right">{w._count.members}</td><td className="text-right">{w._count.businesses}</td><td className="text-xs">{formatDateTime(w.createdAt)}</td></tr>)}
              </tbody></table>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
