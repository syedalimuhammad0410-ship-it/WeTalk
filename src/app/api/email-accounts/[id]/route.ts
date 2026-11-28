import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";

const Body = z.object({
  displayName: z.string().trim().max(100),
  replyTo: z.union([z.literal(""), z.string().trim().email()]),
  signature: z.string().max(2000),
  isDefault: z.boolean(),
  inboundAddress: z.union([z.literal(""), z.string().trim().email()]),
  /** Most emails this inbox sends in any 24 hours; 0 = no cap. */
  dailyLimit: z.number().int().min(0).max(2000),
  sendingEnabled: z.boolean(),
  /** null ends a rest early. */
  restUntil: z.null(),
}).partial();

export const PATCH = api({ permission: "integrations.manage" }, async (req, ctx, p) => {
  const body = await parseBody(req, Body);
  const acc = await db.emailAccount.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!acc) throw new AppError("NOT_FOUND", "Email account not found.");
  if (body.isDefault) await db.emailAccount.updateMany({ where: { workspaceId: ctx.workspace.id }, data: { isDefault: false } });
  await db.emailAccount.update({ where: { id: acc.id }, data: { ...body, inboundAddress: body.inboundAddress === "" ? null : body.inboundAddress } });
  return { ok: true };
});

export const DELETE = api({ permission: "integrations.manage" }, async (_req, ctx, p) => {
  const acc = await db.emailAccount.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!acc) throw new AppError("NOT_FOUND", "Email account not found.");
  // Keep message history; tokens are destroyed with the account row.
  await db.emailAccount.delete({ where: { id: acc.id } });
  // Another inbox becomes the main one.
  if (acc.isDefault) {
    const next = await db.emailAccount.findFirst({ where: { workspaceId: ctx.workspace.id }, orderBy: [{ provider: "asc" }, { createdAt: "asc" }], select: { id: true } });
    if (next) await db.emailAccount.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "email.disconnected", summary: `Email account ${acc.emailAddress} disconnected` });
  return { ok: true };
});
