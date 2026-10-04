import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { getLeadOrThrow, normalizeName, normalizePhone, normalizeWebsite } from "@/lib/server/leads";
import { logActivity } from "@/lib/server/activity";
import { AppError } from "@/lib/server/errors";
import { PLAYBOOKS } from "@/lib/server/intel/playbooks";

const Patch = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).nullable(),
  businessType: z.string().refine((v) => v === "general" || PLAYBOOKS.some((p) => p.id === v), "Unknown business type"),
  address: z.string().trim().max(300).nullable(),
  city: z.string().trim().max(120).nullable(),
  region: z.string().trim().max(120).nullable(),
  phone: z.string().trim().max(40).nullable(),
  website: z.string().trim().max(300).nullable(),
  email: z.union([z.literal(""), z.string().trim().email()]).nullable(),
  emailSource: z.string().trim().max(200).nullable(),
  assignedToId: z.string().nullable(),
  archived: z.boolean(),
}).partial();

export const PATCH = api({ permission: "leads.edit" }, async (req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const b = await parseBody(req, Patch);
  const data: Record<string, unknown> = { ...b };
  if (b.name) data.normalizedName = normalizeName(b.name);
  if (b.phone !== undefined) data.normalizedPhone = normalizePhone(b.phone);
  if (b.website !== undefined) {
    const site = normalizeWebsite(b.website);
    if (b.website && !site) throw new AppError("VALIDATION", "Enter a valid website URL.");
    data.website = site?.url ?? null;
    data.websiteDomain = site?.domain ?? null;
    data.websiteStatus = site ? "WEBSITE_FOUND" : "UNKNOWN";
  }
  if (b.email !== undefined) {
    data.email = b.email ? b.email.toLowerCase() : null;
    data.emailSource = b.email ? b.emailSource ?? lead.emailSource ?? "Entered manually" : null;
  }
  if (b.businessType) data.businessTypeConfidence = 100;
  if (b.assignedToId) {
    const member = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspace.id, userId: b.assignedToId } });
    if (!member) throw new AppError("VALIDATION", "Assignee is not a workspace member.");
  }
  await db.business.update({ where: { id: lead.id }, data });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, businessId: lead.id, action: b.archived !== undefined ? (b.archived ? "lead.archived" : "lead.unarchived") : "lead.updated", summary: b.archived !== undefined ? (b.archived ? "Lead archived" : "Lead restored") : `Lead details updated (${Object.keys(b).join(", ")})` });
  return { ok: true };
});

export const DELETE = api({ permission: "leads.delete" }, async (req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const { confirm } = await parseBody(req, z.object({ confirm: z.literal(true) }));
  if (!confirm) throw new AppError("VALIDATION", "Deletion must be confirmed.");
  // Preserve suppression entries even when a do-not-contact lead is deleted.
  await db.business.delete({ where: { id: lead.id } });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "lead.deleted", summary: `Deleted lead “${lead.name}” and its conversations` });
  return { ok: true };
});
