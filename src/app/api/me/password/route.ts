import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { rateLimit } from "@/lib/server/ratelimit";

export const POST = api({}, async (req, ctx) => {
  await rateLimit(`pw:${ctx.user.id}`, 10, 3600);
  const body = await parseBody(req, z.object({ current: z.string().max(200).optional(), next: z.string().max(200) }));
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (user.passwordHash && !(await verifyPassword(body.current ?? "", user.passwordHash))) throw new AppError("VALIDATION", "Current password is incorrect.");
  const weak = validatePasswordStrength(body.next);
  if (weak) throw new AppError("VALIDATION", weak);
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } });
  return { ok: true };
});
