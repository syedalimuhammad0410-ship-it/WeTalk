import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl } from "@/lib/server/oauth";
import { describeError } from "@/lib/server/errors";
import { getAuthContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const purpose = req.nextUrl.searchParams.get("purpose") === "gmail" ? "gmail" : "signin";
  try {
    if (purpose === "gmail") {
      const ctx = await getAuthContext();
      if (!ctx || !can(ctx.role, "integrations.manage")) return NextResponse.redirect(new URL("/settings/email?error=Only+admins+can+connect+email", req.url));
    }
    return NextResponse.redirect(await googleAuthUrl(purpose));
  } catch (e) {
    const back = purpose === "gmail" ? "/settings/email" : "/login";
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(describeError(e))}`, req.url));
  }
}
