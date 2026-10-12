import "./guard";
import { db } from "../db";

export async function campaignStats(workspaceId: string, campaignId: string) {
  const leadIds = (await db.campaignLead.findMany({ where: { campaignId }, select: { businessId: true } })).map((l) => l.businessId);
  const where = { workspaceId, id: { in: leadIds } };
  // Emails count only when they were sent as part of this campaign.
  const outbound = { workspaceId, campaignId, businessId: { in: leadIds }, direction: "OUTBOUND" as const };
  const [found, qualified, contactedMsgs, failed, inboundAll, interested, meetings, won, lost] = await Promise.all([
    Promise.resolve(leadIds.length),
    db.business.count({ where: { ...where, opportunityScore: { gte: 70 } } }),
    db.emailMessage.findMany({ where: { ...outbound, kind: "OUTREACH", status: { in: ["SENT", "BOUNCED"] } }, select: { businessId: true, status: true, sentAt: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.emailMessage.count({ where: { ...outbound, kind: { in: ["OUTREACH", "FOLLOW_UP"] }, status: { in: ["FAILED", "BOUNCED"] } } }),
    db.emailMessage.findMany({ where: { workspaceId, businessId: { in: leadIds }, direction: "INBOUND" }, select: { businessId: true, createdAt: true } }),
    db.business.count({ where: { ...where, status: { in: ["INTERESTED", "MEETING", "PROPOSAL", "WON"] } } }),
    db.leadStatusChange.findMany({ where: { workspaceId, businessId: { in: leadIds }, toStatus: "MEETING" }, distinct: ["businessId"], select: { businessId: true } }),
    db.business.count({ where: { ...where, status: "WON" } }),
    db.business.count({ where: { ...where, status: "LOST" } }),
  ]);
  // Contacted = businesses sent this campaign's outreach; Delivered = those whose outreach did not bounce.
  const firstSent = new Map<string, Date>();
  const delivered = new Set<string>();
  for (const m of contactedMsgs) {
    if (!m.businessId) continue;
    if (!firstSent.has(m.businessId)) firstSent.set(m.businessId, m.sentAt ?? m.createdAt);
    if (m.status === "SENT") delivered.add(m.businessId);
  }
  // Responses = contacted businesses that replied after this campaign's first email to them.
  const responses = new Set(inboundAll.filter((m) => m.businessId && firstSent.has(m.businessId) && m.createdAt >= firstSent.get(m.businessId)!).map((m) => m.businessId)).size;
  return { found, qualified, contacted: firstSent.size, delivered: delivered.size, failed, responses, interested, meetings: meetings.length, won, lost };
}
