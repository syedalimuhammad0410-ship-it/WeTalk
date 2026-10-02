import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allowedEmails, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { clientIp } from "@/lib/server/api";
import { clearAttempts, durableAttempt } from "@/lib/server/ratelimit";
import { getAccount, recordLogin, saveAccount } from "@/lib/server/accounts";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  if (!process.env.AUTH_SECRET) return NextResponse.json({ error: "Sign-in is not configured on this server (AUTH_SECRET)." }, { status: 503 });
  const ip = clientIp(req);
  const ua = (req.headers.get("user-agent") || "").slice(0, 160);
  const email = body.email.trim().toLowerCase();
  const rl = await durableAttempt(`login:${ip}`, 8, 15 * 60_000).catch(() => ({ ok: true, retryAfterSec: 0 }));
  if (!rl.ok) return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.` }, { status: 429 });

  const fail = async (reason: string, msg = "Access denied. Incorrect email or password.", status = 401) => {
    await recordLogin({ at: new Date().toISOString(), email, ok: false, reason, ip, userAgent: ua });
    return NextResponse.json({ error: msg }, { status });
  };

  let name = "";
  if (allowedEmails().includes(email)) {
    // workspace owner
    if (!(await verifyPassword(body.password, process.env.AUTH_PASSWORD_HASH))) return fail("wrong password");
    name = process.env.AUTH_WELCOME_NAME || "Investigator";
  } else {
    const acct = await getAccount(email);
    // always run a hash comparison so timing doesn't reveal whether the account exists
    const ok = await verifyPassword(body.password, acct?.passwordHash || "scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA==:AAAA");
    if (!acct || !ok) return fail(acct ? "wrong password" : "unknown account");
    if (acct.status === "pending") return fail("pending approval", "Your account is waiting for approval by the workspace owner.", 403);
    if (acct.status === "disabled") return fail("disabled", "This account has been disabled.", 403);
    acct.lastLoginAt = new Date().toISOString();
    acct.loginCount = (acct.loginCount || 0) + 1;
    await saveAccount(acct);
    name = acct.name;
  }
  await clearAttempts(`login:${ip}`).catch(() => undefined);
  await recordLogin({ at: new Date().toISOString(), email, ok: true, ip, userAgent: ua });
  const token = await createSessionToken({ email, name });
  const res = NextResponse.json({ ok: true, name });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
  return res;
}
