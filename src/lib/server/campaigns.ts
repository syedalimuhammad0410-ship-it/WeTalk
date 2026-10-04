import "./guard";
import { db } from "../db";

export async function campaignStats(workspaceId: string, campaignId: string) {
  const leadIds = (await db.campaignLead.findMany({ where: { campaignId }, select: { businessId: true } })).map((l) => l.businessId);
  const where = { workspaceId, id: { in: leadIds } };
  const [found, qualified, contactedMsgs, failed, inbound, interested, meetings, won, lost] = await Promise.all([
    Promise.resolve(leadIds.length),
    db.business.count({ where: { ...where, opportunityScore: { gte: 70 } } }),
    db.emailMessage.findMany({ where: { workspaceId, businessId: { in: leadIds }, direction: "OUTBOUND", kind: "OUTREACH", status: "SENT" }, distinct: ["businessId"], select: { businessId: true } }),
    db.emailMessage.count({ where: { workspaceId, businessId: { in: leadIds }, direction: "OUTBOUND", status: { in: ["FAILED", "BOUNCED"] } } }),
    db.emailMessage.findMany({ where: { workspaceId, businessId: { in: leadIds }, direction: "INBOUND" }, distinct: ["businessId"], select: { businessId: true } }),
    db.business.count({ where: { ...where, status: { in: ["INTERESTED", "MEETING", "PROPOSAL", "WON"] } } }),
    db.leadStatusChange.findMany({ where: { workspaceId, businessId: { in: leadIds }, toStatus: "MEETING" }, distinct: ["businessId"], select: { businessId: true } }),
    db.business.count({ where: { ...where, status: "WON" } }),
    db.business.count({ where: { ...where, status: "LOST" } }),
  ]);
  const sent = await db.emailMessage.count({ where: { workspaceId, businessId: { in: leadIds }, direction: "OUTBOUND", status: "SENT" } });
  return { found, qualified, contacted: contactedMsgs.length, delivered: sent, failed, responses: inbound.length, interested, meetings: meetings.length, won, lost };
}
