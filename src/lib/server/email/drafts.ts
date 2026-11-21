import "../guard";
import { db } from "../../db";
import { describeError } from "../errors";
import { logActivity } from "../activity";

/**
 * Saves the lead's working outreach draft (one per lead — replaces the previous unsent one).
 * Never sends: a person approves and sends drafts from WebScout. Reports whether sending checks pass.
 */
export async function saveOutreachDraft(i: { workspaceId: string; businessId: string; subject: string; body: string; notes: string[]; source: string; userId: string | null }) {
  const business = await db.business.findFirstOrThrow({ where: { id: i.businessId, workspaceId: i.workspaceId } });
  const to =
    business.email ??
    (await db.contact.findFirst({ where: { businessId: business.id, email: { not: null }, eligibility: { not: "INELIGIBLE" } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }))?.email ??
    "";
  const data = { subject: i.subject.trim().slice(0, 200), bodyText: i.body.trim().slice(0, 10000), toAddress: to, aiGenerated: true, analysis: { notes: i.notes, source: i.source } };
  const existing = await db.emailMessage.findFirst({ where: { workspaceId: i.workspaceId, businessId: business.id, status: "DRAFT", kind: "OUTREACH" } });
  const draft = existing
    ? await db.emailMessage.update({ where: { id: existing.id }, data })
    : await db.emailMessage.create({ data: { workspaceId: i.workspaceId, businessId: business.id, direction: "OUTBOUND", status: "DRAFT", kind: "OUTREACH", fromAddress: "", ...data } });
  let blocker: string | null = to ? null : "No email address on file yet — add one on the lead first.";
  if (to) {
    const { checkSendAllowed } = await import("./send");
    blocker = await checkSendAllowed({ workspaceId: i.workspaceId, to, businessId: business.id, kind: "OUTREACH" }).then(() => null, (e: unknown) => describeError(e));
  }
  await logActivity({ workspaceId: i.workspaceId, userId: i.userId, businessId: business.id, action: "email.generated", summary: `Email draft saved (${i.source}) — waiting for approval` });
  return { draft, to, blocker, business };
}
