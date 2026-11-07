import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { getLeadOrThrow } from "@/lib/server/leads";
import { discoverContacts, recordExpressConsent } from "@/lib/server/contacts/discover";

/** Business contacts with their source, validation and outreach-eligibility evidence. */
export const GET = api({ permission: "leads.view" }, async (_req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const [contacts, consent] = await Promise.all([
    db.contact.findMany({ where: { businessId: lead.id, email: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
    db.consentRecord.findMany({ where: { businessId: lead.id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { contacts, consent };
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("discover") }),
  z.object({ action: z.literal("express_consent"), contactId: z.string(), note: z.string().trim().min(10, "Describe how consent was given (at least 10 characters).").max(500) }),
]);

export const POST = api({ permission: "leads.edit" }, async (req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const b = await parseBody(req, Body);
  if (b.action === "discover") return discoverContacts(ctx.workspace.id, lead.id, { userId: ctx.user.id });
  assertCan(ctx, "compliance.manage");
  await recordExpressConsent(ctx.workspace.id, b.contactId, ctx.user.id, b.note);
  return { ok: true };
});
export const maxDuration = 120;
