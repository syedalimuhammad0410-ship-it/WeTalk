import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl } from "@/lib/server/oauth";
import { describeError } from "@/lib/server/errors";
import { getAuthContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { env } from "@/lib/server/env";

export async function GET(req: NextRequest) {
  const purpose = req.nextUrl.searchParams.get("purpose") === "gmail" ? "gmail" : "signin";
  // Redirect to the public URL: behind a proxy (e.g. Render) req.url is the internal address.
  try {
    if (purpose === "gmail") {
      const ctx = await getAuthContext();
      if (!ctx || !can(ctx.role, "integrations.manage")) return NextResponse.redirect(new URL("/settings/email?error=Only+admins+can+connect+email", env.appUrl()));
    }
    const res = NextResponse.redirect(await googleAuthUrl(purpose));
    const next = req.nextUrl.searchParams.get("next");
    if (purpose === "signin" && next && next.startsWith("/") && !next.startsWith("//")) res.cookies.set("ws_oauth_next", next, { httpOnly: true, sameSite: "lax", secure: env.isProduction(), path: "/", maxAge: 600 });
    return res;
  } catch (e) {
    const back = purpose === "gmail" ? "/settings/email" : "/login";
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(describeError(e))}`, env.appUrl()));
  }
}
