import "./guard";
import type { Prisma } from "@prisma/client";
import { db } from "../db";

type Tx = Prisma.TransactionClient | typeof db;

export async function logActivity(
  input: {
    workspaceId: string;
    userId?: string | null;
    businessId?: string | null;
    action: string;
    summary: string;
    details?: Prisma.InputJsonValue;
  },
  tx: Tx = db,
) {
  return tx.activityLog.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      businessId: input.businessId ?? null,
      action: input.action,
      summary: input.summary,
      details: input.details,
    },
  });
}

export const NOTIFICATION_TYPES = {
  NEW_RESPONSE: "New response arrives",
  AI_DRAFT_READY: "AI response is ready",
  HOT_LEAD: "Hot lead detected",
  HUMAN_REVIEW: "Human review required",
  FOLLOW_UP_DUE: "Follow-up due",
  MEETING_REQUESTED: "Meeting requested",
  EMAIL_FAILURE: "Email failure",
  API_FAILURE: "API failure",
  JOB_COMPLETED: "Background job finished",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/**
 * Creates one notification per workspace member who has not opted out of the type.
 * Preferences live on WorkspaceMember.notificationPrefs as { [type]: boolean }.
 */
export async function notify(input: {
  workspaceId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  onlyUserId?: string;
}) {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: input.workspaceId, ...(input.onlyUserId ? { userId: input.onlyUserId } : {}) },
    select: { userId: true, notificationPrefs: true, role: true },
  });
  const recipients = members.filter((m) => {
    const prefs = (m.notificationPrefs ?? {}) as Record<string, boolean>;
    if (prefs[input.type] === false) return false;
    // Viewers only receive informational notifications.
    if (m.role === "VIEWER" && ["HUMAN_REVIEW", "AI_DRAFT_READY", "FOLLOW_UP_DUE"].includes(input.type)) return false;
    return true;
  });
  if (recipients.length === 0) return 0;
  await db.notification.createMany({
    data: recipients.map((r) => ({
      workspaceId: input.workspaceId,
      userId: r.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      link: input.link ?? null,
    })),
  });
  return recipients.length;
}
