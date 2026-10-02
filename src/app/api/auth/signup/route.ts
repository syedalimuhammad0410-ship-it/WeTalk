import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { clientIp } from "@/lib/server/api";
import { durableAttempt } from "@/lib/server/ratelimit";
import { accountSettings, getAccount, isOwner, saveAccount } from "@/lib/server/accounts";

const Body = z.object({ name: z.string().trim().min(1).max(80), email: z.string().email().max(200), password: z.string().min(8).max(200) });

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Enter your name, a valid email and a password of at least 8 characters." }, { status: 400 });
  }
  const rl = await durableAttempt(`signup:${clientIp(req)}`, 5, 60 * 60_000).catch(() => ({ ok: true, retryAfterSec: 0 }));
  if (!rl.ok) return NextResponse.json({ error: "Too many sign-ups from this network. Try again later." }, { status: 429 });
  const settings = await accountSettings();
  if (!settings.allowSignups) return NextResponse.json({ error: "New sign-ups are currently closed." }, { status: 403 });
  const email = body.email.trim().toLowerCase();
  if (isOwner(email) || (await getAccount(email))) return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  const status = settings.requireApproval ? "pending" : "active";
  await saveAccount({ email, name: body.name, passwordHash: await hashPassword(body.password), status, createdAt: new Date().toISOString(), loginCount: 0, approvedAt: status === "active" ? new Date().toISOString() : undefined });
  return NextResponse.json({ ok: true, status });
}
