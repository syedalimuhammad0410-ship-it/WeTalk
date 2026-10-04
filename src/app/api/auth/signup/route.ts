import * as z from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, parseBody, publicApi } from "@/lib/server/api";
import { createSession, hashPassword, setSessionCookie, validatePasswordStrength } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { env } from "@/lib/server/env";
import { rateLimit } from "@/lib/server/ratelimit";
import { acceptInvitation } from "@/lib/server/members";

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().max(200),
  invite: z.string().optional(),
});

export const POST = publicApi(async (req) => {
  await rateLimit(`signup:${clientIp(req)}`, Number(process.env.SIGNUP_RATE_LIMIT_PER_HOUR) || 10, 3600, "Too many sign-up attempts from this network. Try again later.");
  const body = await parseBody(req, Body);
  const weak = validatePasswordStrength(body.password);
  if (weak) throw new AppError("VALIDATION", weak);
  if (await db.user.findUnique({ where: { email: body.email } })) throw new AppError("CONFLICT", "An account with this email already exists. Sign in instead.");
  const user = await db.user.create({
    data: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password), isSystemAdmin: env.systemAdminEmails().includes(body.email) || (await db.user.count()) === 0 },
  });
  if (body.invite) await acceptInvitation(body.invite, user.id, user.email);
  const s = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  await setSessionCookie(s.token, s.expiresAt);
  return NextResponse.json({ ok: true, next: body.invite ? "/dashboard" : "/onboarding" });
});
