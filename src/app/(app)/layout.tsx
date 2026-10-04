import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { AppShell } from "@/components/shell/app-shell";
import { kickRunner } from "@/lib/server/jobs/runner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageContext();
  kickRunner();
  const [memberships, unread, review, followups, defaultAccount] = await Promise.all([
    db.workspaceMember.findMany({ where: { userId: ctx.user.id }, include: { workspace: { select: { id: true, name: true, isDemo: true } } }, orderBy: { createdAt: "asc" } }),
    db.conversation.count({ where: { workspaceId: ctx.workspace.id, unread: true } }),
    db.conversation.count({ where: { workspaceId: ctx.workspace.id, needsHumanReview: true, unread: false } }),
    db.followUp.count({ where: { workspaceId: ctx.workspace.id, status: "PENDING_APPROVAL" } }),
    db.emailAccount.findFirst({ where: { workspaceId: ctx.workspace.id, isDefault: true }, select: { provider: true } }),
  ]);
  return (
    <AppShell
      user={{ name: ctx.user.name, email: ctx.user.email, isSystemAdmin: ctx.user.isSystemAdmin }}
      workspace={{ id: ctx.workspace.id, name: ctx.workspace.name, isDemo: ctx.workspace.isDemo }}
      role={ctx.role}
      workspaces={memberships.map((m) => ({ ...m.workspace, role: m.role }))}
      counts={{ inbox: unread + review, followups }}
      sandbox={defaultAccount?.provider === "SANDBOX" && !ctx.workspace.isDemo}
    >
      {children}
    </AppShell>
  );
}
