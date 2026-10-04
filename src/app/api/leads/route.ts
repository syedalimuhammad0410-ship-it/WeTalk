import * as z from "zod";
import { api, parseBody, parseQuery } from "@/lib/server/api";
import { upsertBusiness } from "@/lib/server/leads";
import { LeadFilters, listLeads } from "@/lib/server/queries";
import { classifyBusinessType } from "@/lib/server/intel/classify-type";
import { db } from "@/lib/db";
import { AppError } from "@/lib/server/errors";

export const GET = api({}, async (req, ctx) => listLeads(ctx.workspace.id, parseQuery(req, LeadFilters)));

const Create = z.object({
  name: z.string().trim().min(1, "Business name is required").max(200),
  category: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(300).optional(),
  email: z.union([z.literal(""), z.string().trim().email()]).optional(),
  emailSource: z.string().trim().max(200).optional(),
});

export const POST = api({ permission: "leads.edit" }, async (req, ctx) => {
  const b = await parseBody(req, Create);
  const r = await upsertBusiness(ctx.workspace.id, { ...b, email: b.email || null, emailSource: b.email ? b.emailSource || "Entered manually" : null, source: "MANUAL" }, ctx.user.id);
  if (!r.created) throw new AppError("CONFLICT", `This business already exists in your workspace (matched by ${r.duplicateReason}).`, { id: r.business.id });
  const t = classifyBusinessType({ category: b.category, name: b.name });
  await db.business.update({ where: { id: r.business.id }, data: { businessType: t.playbook.id, businessTypeConfidence: t.confidence } });
  return { id: r.business.id };
});
