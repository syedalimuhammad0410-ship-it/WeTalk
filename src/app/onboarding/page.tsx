import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAuthContext, getSessionUser } from "@/lib/server/auth";
import { integrationSummary, getSettings } from "@/lib/server/workspace";
import { Onboarding } from "@/components/onboarding/onboarding";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getAuthContext();
  if (!ctx) return <Onboarding initial={{ step: 1, hasWorkspace: false, userName: user.name }} />;
  const [integrations, settings] = await Promise.all([integrationSummary(ctx.workspace.id), getSettings(ctx.workspace.id)]);
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspace.id } });
  return (
    <Onboarding
      initial={{
        step: Math.max(2, ws.onboardingStep),
        hasWorkspace: true,
        userName: user.name,
        workspaceName: ws.name,
        role: ctx.role,
        integrations: JSON.parse(JSON.stringify(integrations)),
        company: JSON.parse(JSON.stringify(settings.company)),
        automation: { responseMode: settings.automation.responseMode, responseTone: settings.automation.responseTone, automaticReplies: settings.automation.automaticReplies, automaticFollowUps: settings.automation.automaticFollowUps, followUpDays: settings.automation.followUpDays },
      }}
    />
  );
}
