import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { getSettings } from "@/lib/server/workspace";
import { PageHeader } from "@/components/ui/misc";
import { FollowUpsView } from "@/components/followups/followups-view";

export const metadata = { title: "Follow-Ups" };

export default async function FollowUpsPage() {
  const ctx = await pageContext();
  const ws = ctx.workspace.id;
  const include = { business: { select: { id: true, name: true, email: true, status: true } }, campaign: { select: { name: true } } } as const;
  // Upcoming follow-ups are always shown in full; history is the most recent 300.
  const [open, history, settings] = await Promise.all([
    db.followUp.findMany({ where: { workspaceId: ws, status: { in: ["PENDING_APPROVAL", "SCHEDULED"] } }, orderBy: [{ scheduledFor: "asc" }], take: 2000, include }),
    db.followUp.findMany({ where: { workspaceId: ws, status: { notIn: ["PENDING_APPROVAL", "SCHEDULED"] } }, orderBy: [{ updatedAt: "desc" }], take: 300, include }),
    getSettings(ws),
  ]);
  const items = [...open, ...history];
  return (
    <div>
      <PageHeader title="Follow-Ups" description={`Bounded follow-ups (max ${settings.compliance.maxFollowUps} per business; schedule day ${settings.automation.followUpDays.join(", day ")}). They stop when a business replies, says no, unsubscribes or becomes a customer.`} />
      <FollowUpsView items={JSON.parse(JSON.stringify(items))} canSend={ctx.can("emails.send")} automatic={settings.automation.automaticFollowUps} />
    </div>
  );
}
