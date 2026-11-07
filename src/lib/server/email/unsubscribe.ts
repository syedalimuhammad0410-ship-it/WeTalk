import "../guard";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../../db";
import { env } from "./../env";
import { logActivity } from "../activity";
import { changeLeadStatus } from "../leads";
import { withdrawConsent } from "../contacts/discover";

const secret = () => process.env.APP_ENCRYPTION_KEY || "webscout-dev-unsubscribe";
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 22);

/** A signed, non-expiring token identifying the workspace and recipient. */
export function unsubscribeToken(workspaceId: string, email: string) {
  const payload = Buffer.from(JSON.stringify({ w: workspaceId, e: email.toLowerCase() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function unsubscribeUrl(workspaceId: string, email: string) {
  return `${env.appUrl()}/unsubscribe/${unsubscribeToken(workspaceId, email)}`;
}

export function readUnsubscribeToken(token: string): { workspaceId: string; email: string } | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { w?: string; e?: string };
    return v.w && v.e ? { workspaceId: v.w, email: v.e } : null;
  } catch {
    return null;
  }
}

/** Honours an unsubscribe: suppression list, consent withdrawn, lead marked Do Not Contact. Idempotent. */
export async function processUnsubscribe(workspaceId: string, email: string) {
  const lower = email.toLowerCase();
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!ws) return false;
  await db.suppressionEntry.upsert({ where: { workspaceId_value: { workspaceId, value: lower } }, create: { workspaceId, value: lower, reason: "Unsubscribed via email link" }, update: {} });
  await withdrawConsent(workspaceId, lower, "Unsubscribed via email link");
  const businesses = await db.business.findMany({ where: { workspaceId, OR: [{ email: lower }, { contacts: { some: { email: lower } } }], doNotContact: false }, select: { id: true } });
  for (const b of businesses) await changeLeadStatus({ workspaceId, businessId: b.id, to: "DO_NOT_CONTACT", reason: "Unsubscribed via email link" });
  await logActivity({ workspaceId, action: "lead.unsubscribed", summary: `${lower} unsubscribed using the email link` });
  return true;
}
