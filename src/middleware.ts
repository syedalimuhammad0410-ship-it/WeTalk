import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/signup", "/invite", "/api", "/_next", "/favicon", "/icon", "/robots.txt"];

/** Cheap edge check: send visitors without a session cookie to sign-in. Real validation happens server-side. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p + "?"))) return NextResponse.next();
  if (!req.cookies.get("ws_session")) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
