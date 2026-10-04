import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { getLeadOrThrow } from "@/lib/server/leads";
import { generateOutreachDraft } from "@/lib/server/email/compose";

export const POST = api({ permission: "emails.compose" }, async (req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const body = await parseBody(req, z.object({ templateId: z.string().nullable().optional(), campaignId: z.string().nullable().optional() }).default({})).catch(() => ({}) as { templateId?: string | null; campaignId?: string | null });
  const r = await generateOutreachDraft(ctx.workspace.id, lead.id, ctx.user.id, body);
  return { draftId: r.draft.id, subject: r.draft.subject, body: r.draft.bodyText, to: r.draft.toAddress, aiGenerated: r.draft.aiGenerated, notes: r.notes };
});
export const maxDuration = 120;
