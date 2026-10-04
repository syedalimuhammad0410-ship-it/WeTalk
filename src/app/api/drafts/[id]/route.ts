import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";

export const PATCH = api({ permission: "emails.compose" }, async (req, ctx, p) => {
  const d = await db.aiResponseDraft.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id, status: "PENDING" } });
  if (!d) throw new AppError("NOT_FOUND", "Pending draft not found.");
  const b = await parseBody(req, z.object({ subject: z.string().trim().min(1).max(300).optional(), body: z.string().trim().min(1).max(20000).optional() }));
  return db.aiResponseDraft.update({ where: { id: d.id }, data: b });
});
