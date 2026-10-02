import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allowedEmails, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { clientIp } from "@/lib/server/api";
import { clearAttempts, durableAttempt } from "@/lib/server/ratelimit";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  if (!process.env.AUTH_SECRET || !process.env.AUTH_PASSWORD_HASH || !allowedEmails().length) {
    return NextResponse.json({ error: "Sign-in is not configured on this server (AUTH_SECRET, AUTH_PASSWORD_HASH, AUTH_ALLOWED_EMAILS)." }, { status: 503 });
  }
  const ip = clientIp(req);
  const email = body.email.trim().toLowerCase();
  const rl = await durableAttempt(`login:${ip}`, 8, 15 * 60_000).catch(() => ({ ok: true, retryAfterSec: 0 }));
  if (!rl.ok) return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.` }, { status: 429 });

  const allowed = allowedEmails().includes(email);
  // Always run the hash to keep timing uniform whether or not the email is authorized.
  const pwOk = await verifyPassword(body.password, process.env.AUTH_PASSWORD_HASH);
  if (!allowed || !pwOk) {
    // Same message either way so the endpoint does not reveal which emails are authorized.
    return NextResponse.json({ error: "Access denied. Incorrect password, or this email is not authorized for TRACE." }, { status: 401 });
  }
  await clearAttempts(`login:${ip}`).catch(() => undefined);
  const name = process.env.AUTH_WELCOME_NAME || "Investigator";
  const token = await createSessionToken({ email, name });
  const res = NextResponse.json({ ok: true, name });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
