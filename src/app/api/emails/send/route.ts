import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { checkSendAllowed, getSendingAccount, sendEmail } from "@/lib/server/email/send";

/** Sends an outreach draft after explicit confirmation. `dryRun` returns the confirmation summary only. */
export const POST = api({ permission: "emails.send" }, async (req, ctx) => {
  const b = await parseBody(req, z.object({ draftId: z.string(), confirmed: z.boolean().default(false), dryRun: z.boolean().default(false) }));
  const draft = await db.emailMessage.findFirst({ where: { id: b.draftId, workspaceId: ctx.workspace.id, status: "DRAFT" }, include: { business: true, campaign: true } });
  if (!draft) throw new AppError("NOT_FOUND", "Draft not found (it may already have been sent).");
  if (!draft.toAddress) throw new AppError("VALIDATION", "Add a recipient email address first.");
  const account = await getSendingAccount(ctx.workspace.id);
  await checkSendAllowed({ workspaceId: ctx.workspace.id, to: draft.toAddress, businessId: draft.businessId, kind: draft.kind });
  const summary = {
    recipient: draft.toAddress,
    subject: draft.subject,
    message: draft.bodyText,
    business: draft.business?.name ?? null,
    source: draft.business?.emailSource ?? "Unknown source",
    campaign: draft.campaign?.name ?? null,
    from: account.emailAddress,
    provider: account.provider,
    sandbox: account.provider === "SANDBOX",
  };
  if (b.dryRun) return { confirmRequired: true, summary };
  const settings = await db.automationSettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if ((settings?.requireSendConfirmation ?? true) && !b.confirmed) return { confirmRequired: true, summary };
  const r = await sendEmail({ workspaceId: ctx.workspace.id, userId: ctx.user.id, to: draft.toAddress, subject: draft.subject, body: draft.bodyText, kind: draft.kind, businessId: draft.businessId, campaignId: draft.campaignId, draftMessageId: draft.id, aiGenerated: draft.aiGenerated });
  return { sent: true, messageId: r.message.id, conversationId: r.conversationId, sandbox: r.sandbox };
});
