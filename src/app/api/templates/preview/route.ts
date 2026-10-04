import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { renderTemplate, type TemplateVars } from "@/lib/server/email/templates";
import { templateVarsFor } from "@/lib/server/email/compose";

/** Renders a template against a real lead (or sample values when no lead is chosen). */
export const POST = api({}, async (req, ctx) => {
  const b = await parseBody(req, z.object({ subject: z.string().max(300), body: z.string().max(10000), businessId: z.string().nullable().optional() }));
  let vars: TemplateVars;
  let sample = false;
  if (b.businessId) {
    const lead = await db.business.findFirst({ where: { id: b.businessId, workspaceId: ctx.workspace.id } });
    if (!lead) throw new AppError("NOT_FOUND", "Lead not found.");
    vars = (await templateVarsFor(ctx.workspace.id, lead)).vars;
  } else {
    sample = true;
    vars = { business_name: "[Business name]", contact_name: "there", website: "[website]", city: "[City]", category: "[category]", website_score: "[score]", opportunity_score: "[score]", top_issue: "[specific observation from the audit]", top_opportunity: "[specific opportunity]", sender_name: "[Your name]", company_name: "[Your company]", meeting_link: "[meeting link]" };
  }
  const s = renderTemplate(b.subject, vars);
  const body = renderTemplate(b.body, vars);
  return { subject: s.text, body: body.text, missing: Array.from(new Set([...s.missing, ...body.missing])), sample };
});
