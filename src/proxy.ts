import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

// Optimistic gate for app pages: only checks that a session cookie exists.
// The signature/allow-list check happens server-side on every API request (route()
// wrapper); an invalid session gets 401 there and the client returns to /login.
// (On Netlify the proxy runs in an edge environment without access to AUTH_SECRET.)
export function proxy(req: NextRequest) {
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*"] };
