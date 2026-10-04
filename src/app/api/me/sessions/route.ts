import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { sha256 } from "@/lib/server/crypto";

/** Signs out all other sessions for the current user. */
export const DELETE = api({}, async (_req, ctx) => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const r = await db.session.deleteMany({ where: { userId: ctx.user.id, tokenHash: { not: sha256(token) } } });
  return { revoked: r.count };
});
