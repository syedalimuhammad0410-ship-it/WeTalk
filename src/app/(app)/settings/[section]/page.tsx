import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { getSettings, integrationSummary } from "@/lib/server/workspace";
import { NOTIFICATION_TYPES } from "@/lib/server/activity";
import { PageHeader } from "@/components/ui/misc";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";
import { SettingsSection } from "@/components/settings/settings-sections";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ error?: string; connected?: string }> }) {
  const ctx = await pageContext();
  const { section } = await params;
  if (!SETTINGS_SECTIONS.some((s) => s.id === section)) notFound();
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  const [settings, integrations, member, user, members, invitations, suppressions, sessions, counts] = await Promise.all([
    getSettings(ws),
    integrationSummary(ws),
    db.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: ws, userId: ctx.user.id } } }),
    db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { name: true, email: true, passwordHash: true, googleId: true, createdAt: true } }),
    db.workspaceMember.findMany({ where: { workspaceId: ws }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.invitation.findMany({ where: { workspaceId: ws, acceptedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, role: true, expiresAt: true } }),
    db.suppressionEntry.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.session.findMany({ where: { userId: ctx.user.id }, orderBy: { lastUsedAt: "desc" }, select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true, ipAddress: true } }),
    Promise.all([db.business.count({ where: { workspaceId: ws } }), db.conversation.count({ where: { workspaceId: ws } }), db.campaign.count({ where: { workspaceId: ws } })]),
  ]);
  const accounts = await db.emailAccount.findMany({ where: { workspaceId: ws }, select: { id: true, provider: true, emailAddress: true, displayName: true, replyTo: true, signature: true, status: true, lastError: true, lastSyncAt: true, isDefault: true, inboundAddress: true } });
  const data = {
    section, error: sp.error ?? null, connected: sp.connected ?? null,
    workspace: ctx.workspace, role: ctx.role, permissions: Array.from(ROLE_PERMISSIONS[ctx.role]),
    user: { ...user, hasPassword: Boolean(user.passwordHash), passwordHash: undefined, hasGoogle: Boolean(user.googleId) },
    settings, integrations, accounts, members, invitations, suppressions, sessions,
    notificationPrefs: member.notificationPrefs, notificationTypes: NOTIFICATION_TYPES,
    counts: { leads: counts[0], conversations: counts[1], campaigns: counts[2] },
    currentUserId: ctx.user.id,
  };
  return (
    <div>
      <PageHeader title="Settings" description={`${ctx.workspace.name} · you are ${ctx.role.toLowerCase()}`} />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav active={section} />
        <div className="min-w-0"><SettingsSection data={JSON.parse(JSON.stringify(data))} /></div>
      </div>
    </div>
  );
}
