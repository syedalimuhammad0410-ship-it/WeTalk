import * as z from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, parseBody, publicApi } from "@/lib/server/api";
import { createSession, setSessionCookie, verifyPassword, resolveWorkspace } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), password: z.string().min(1, "Enter your password").max(200) });

export const POST = publicApi(async (req) => {
  const body = await parseBody(req, Body);
  await rateLimit(`login:${clientIp(req)}`, 20, 900, "Too many sign-in attempts. Wait 15 minutes and try again.");
  await rateLimit(`login-user:${body.email}`, 8, 900, "Too many attempts for this account. Wait 15 minutes and try again.");
  const user = await db.user.findUnique({ where: { email: body.email } });
  // Constant-ish time: always run bcrypt.
  const ok = await verifyPassword(body.password, user?.passwordHash ?? "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.dummy.hash.for.timing.only.");
  if (!user || !user.passwordHash || !ok) throw new AppError("UNAUTHENTICATED", user && !user.passwordHash ? "This account uses Google sign-in." : "Incorrect email or password.");
  const s = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  await setSessionCookie(s.token, s.expiresAt);
  const m = await resolveWorkspace(user);
  return NextResponse.json({ ok: true, next: m ? "/dashboard" : "/onboarding" });
});
