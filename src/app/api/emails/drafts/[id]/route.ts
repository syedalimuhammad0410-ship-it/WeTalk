import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";

export const PATCH = api({ permission: "emails.compose" }, async (req, ctx, p) => {
  const d = await db.emailMessage.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id, status: "DRAFT" } });
  if (!d) throw new AppError("NOT_FOUND", "Draft not found (it may have been sent).");
  const b = await parseBody(req, z.object({ subject: z.string().max(300).optional(), body: z.string().max(20000).optional(), to: z.union([z.literal(""), z.string().trim().email()]).optional(), campaignId: z.string().nullable().optional() }));
  return db.emailMessage.update({ where: { id: d.id }, data: { subject: b.subject, bodyText: b.body, toAddress: b.to?.toLowerCase(), campaignId: b.campaignId } });
});

export const DELETE = api({ permission: "emails.compose" }, async (_req, ctx, p) => {
  const d = await db.emailMessage.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id, status: "DRAFT" } });
  if (!d) throw new AppError("NOT_FOUND", "Draft not found.");
  await db.emailMessage.delete({ where: { id: d.id } });
  return { ok: true };
});
