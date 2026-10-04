import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { encryptSecret, randomToken, sha256 } from "@/lib/server/crypto";
import { AppError } from "@/lib/server/errors";
import { env } from "@/lib/server/env";
import { logActivity } from "@/lib/server/activity";

const Body = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("POSTMARK"), emailAddress: z.string().trim().email(), displayName: z.string().trim().max(100).default(""), serverToken: z.string().trim().min(10), inboundAddress: z.union([z.literal(""), z.string().trim().email()]).default("") }),
  z.object({ provider: z.literal("SANDBOX"), emailAddress: z.string().trim().email(), displayName: z.string().trim().max(100).default("") }),
]);

export const GET = api({}, async (_req, ctx) =>
  db.emailAccount.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, provider: true, emailAddress: true, displayName: true, replyTo: true, signature: true, status: true, lastError: true, lastSyncAt: true, isDefault: true, inboundAddress: true },
  }),
);

export const POST = api({ permission: "integrations.manage" }, async (req, ctx) => {
  const body = await parseBody(req, Body);
  if (body.provider === "SANDBOX" && !env.sandboxEmailEnabled()) throw new AppError("FORBIDDEN", "The email sandbox is disabled on this server.");
  let inboundToken: string | null = null;
  const data: Parameters<typeof db.emailAccount.create>[0]["data"] = {
    workspaceId: ctx.workspace.id,
    provider: body.provider,
    emailAddress: body.emailAddress.toLowerCase(),
    displayName: body.displayName,
    isDefault: true,
  };
  if (body.provider === "POSTMARK") {
    inboundToken = randomToken(24);
    data.apiTokenEncrypted = encryptSecret(body.serverToken);
    data.inboundTokenHash = sha256(inboundToken);
    data.inboundAddress = body.inboundAddress || null;
  }
  await db.emailAccount.updateMany({ where: { workspaceId: ctx.workspace.id }, data: { isDefault: false } });
  const acc = await db.emailAccount.create({ data });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "email.connected", summary: `${body.provider === "SANDBOX" ? "Email SANDBOX" : "Postmark"} account ${acc.emailAddress} connected` });
  return { id: acc.id, inboundWebhookUrl: inboundToken ? `${env.appUrl()}/api/webhooks/inbound/postmark/${inboundToken}` : null };
});
