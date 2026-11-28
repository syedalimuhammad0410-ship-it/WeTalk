import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl } from "@/lib/server/oauth";
import { describeError } from "@/lib/server/errors";
import { getAuthContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { env } from "@/lib/server/env";
import { db } from "@/lib/db";
import { MAX_GMAIL_ACCOUNTS } from "@/lib/server/email/inboxes";

export async function GET(req: NextRequest) {
  const purpose = req.nextUrl.searchParams.get("purpose") === "gmail" ? "gmail" : "signin";
  // Redirect to the public URL: behind a proxy (e.g. Render) req.url is the internal address.
  try {
    if (purpose === "gmail") {
      const ctx = await getAuthContext();
      if (!ctx || !can(ctx.role, "integrations.manage")) return NextResponse.redirect(new URL("/settings/email?error=Only+admins+can+connect+email", env.appUrl()));
    }
    // ?hint=address reconnects that inbox; without it, a new inbox is being added (at most 5 Gmail accounts).
    const hint = req.nextUrl.searchParams.get("hint")?.trim().toLowerCase() ?? "";
    const loginHint = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(hint) ? hint : undefined;
    if (purpose === "gmail" && !loginHint) {
      const ctx = await getAuthContext();
      const linked = ctx ? await db.emailAccount.count({ where: { workspaceId: ctx.workspace.id, provider: "GMAIL" } }) : 0;
      if (linked >= MAX_GMAIL_ACCOUNTS) return NextResponse.redirect(new URL(`/settings/email?error=${encodeURIComponent(`You've linked ${MAX_GMAIL_ACCOUNTS} Gmail accounts, the most WebScout allows. Disconnect one to add another.`)}`, env.appUrl()));
    }
    const res = NextResponse.redirect(await googleAuthUrl(purpose, { loginHint }));
    const next = req.nextUrl.searchParams.get("next");
    if (purpose === "signin" && next && next.startsWith("/") && !next.startsWith("//")) res.cookies.set("ws_oauth_next", next, { httpOnly: true, sameSite: "lax", secure: env.isProduction(), path: "/", maxAge: 600 });
    return res;
  } catch (e) {
    const back = purpose === "gmail" ? "/settings/email" : "/login";
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(describeError(e))}`, env.appUrl()));
  }
}
