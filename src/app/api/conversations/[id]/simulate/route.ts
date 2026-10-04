import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { ingestInbound } from "@/lib/server/email/inbound";
import { randomToken } from "@/lib/server/crypto";

/**
 * SANDBOX ONLY: simulates the business replying, so the full reply pipeline can
 * be exercised without a real mailbox. Refused for real email providers.
 */
export const POST = api({ permission: "emails.send" }, async (req, ctx, p) => {
  const conv = await db.conversation.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id }, include: { emailAccount: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!conv) throw new AppError("NOT_FOUND", "Conversation not found.");
  if (conv.emailAccount?.provider !== "SANDBOX") throw new AppError("FORBIDDEN", "Simulated replies are only available for SANDBOX email accounts.");
  const { body } = await parseBody(req, z.object({ body: z.string().trim().min(1).max(5000) }));
  const last = conv.messages[0];
  const r = await ingestInbound(conv.emailAccount, {
    providerMessageId: `sandbox-in-${randomToken(10)}`,
    rfcMessageId: `<sim-${randomToken(10)}@sandbox.invalid>`,
    inReplyTo: last?.rfcMessageId ?? null,
    references: last?.rfcMessageId ?? null,
    providerThreadId: null,
    from: conv.counterpartEmail,
    fromName: null,
    to: conv.emailAccount.emailAddress,
    subject: conv.subject.toLowerCase().startsWith("re:") ? conv.subject : `Re: ${conv.subject}`,
    text: body,
    html: null,
    receivedAt: new Date(),
  });
  return r;
});
