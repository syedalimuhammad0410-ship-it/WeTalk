import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/server/env";
import { processUnsubscribe, readUnsubscribeToken } from "@/lib/server/email/unsubscribe";

/**
 * Unsubscribe endpoint: the confirmation page's form posts here, and mail clients
 * may POST here directly (RFC 8058 one-click). No sign-in needed — the token is signed.
 */
export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) {
    const form = await req.formData().catch(() => null);
    token = String(form?.get("token") ?? "");
  }
  const t = readUnsubscribeToken(token);
  if (!t) return NextResponse.json({ error: { code: "VALIDATION", message: "This unsubscribe link is invalid." } }, { status: 400 });
  await processUnsubscribe(t.workspaceId, t.email);
  return NextResponse.redirect(new URL(`/unsubscribe/${token}?done=1`, env.appUrl()), 303);
}
