import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { systemHealth } from "@/lib/server/health";
import { integrationSummary, getSettings } from "@/lib/server/workspace";
import { PageHeader } from "@/components/ui/misc";
import { AdminView } from "@/components/admin/admin-view";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const ctx = await pageContext();
  if (!(ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.user.isSystemAdmin)) redirect("/dashboard");
  const ws = ctx.workspace.id;
  const since = new Date(Date.now() - 30 * 86400_000);
  const [health, integrations, settings, members, jobs, failedJobs, logs, aiUsage, emailActivity, usage, allWorkspaces] = await Promise.all([
    systemHealth(ws),
    integrationSummary(ws),
    getSettings(ws),
    db.workspaceMember.findMany({ where: { workspaceId: ws }, include: { user: { select: { name: true, email: true, createdAt: true } } } }),
    db.job.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, label: true, type: true, status: true, progress: true, error: true, createdAt: true, finishedAt: true } }),
    db.job.findMany({ where: { workspaceId: ws, status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, label: true, type: true, error: true, createdAt: true } }),
    db.activityLog.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 60, include: { user: { select: { name: true } }, business: { select: { id: true, name: true } } } }),
    db.aiUsage.groupBy({ by: ["feature", "success"], where: { workspaceId: ws, createdAt: { gte: since } }, _count: true, _sum: { inputTokens: true, outputTokens: true } }),
    db.emailMessage.groupBy({ by: ["direction", "status"], where: { workspaceId: ws, createdAt: { gte: since } }, _count: true }),
    Promise.all([db.business.count({ where: { workspaceId: ws } }), db.websiteAudit.count({ where: { workspaceId: ws } }), db.generatedPrompt.count({ where: { workspaceId: ws } }), db.conversation.count({ where: { workspaceId: ws } })]),
    ctx.user.isSystemAdmin ? db.workspace.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, isDemo: true, createdAt: true, _count: { select: { members: true, businesses: true } } } }) : Promise.resolve([]),
  ]);
  return (
    <div>
      <PageHeader title="Admin control center" description="System health, configuration, jobs, logs and usage for this workspace." />
      <AdminView data={JSON.parse(JSON.stringify({ health, integrations, automation: settings.automation, compliance: settings.compliance, members, jobs, failedJobs, logs, aiUsage, emailActivity, usage: { leads: usage[0], audits: usage[1], prompts: usage[2], conversations: usage[3] }, allWorkspaces, isSystemAdmin: ctx.user.isSystemAdmin }))} />
    </div>
  );
}
