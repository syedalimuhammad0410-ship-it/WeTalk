import "server-only";
import { NextResponse, after, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, verifySessionToken, type SessionClaims } from "@/lib/auth/session";
import { rateLimit } from "./ratelimit";
import { flushUsage, recordUsage } from "./usage";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function currentUser(): Promise<SessionClaims | null> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

type Handler<C> = (req: NextRequest, ctx: { user: SessionClaims; params: C }) => Promise<Response | unknown>;

/**
 * Wraps a route handler: authentication, per-user rate limiting, error mapping,
 * and post-response usage flushing.
 */
export function route<C = Record<string, string>>(
  handler: Handler<C>,
  opts: { limit?: number; windowMs?: number; name?: string } = {},
) {
  return async (req: NextRequest, ctx: { params: Promise<C> }) => {
    const started = Date.now();
    try {
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Authentication required.", "unauthenticated");
      const rl = rateLimit(`${user.email}:${opts.name || req.nextUrl.pathname}`, opts.limit ?? 120, opts.windowMs ?? 60_000);
      if (!rl.ok) throw new HttpError(429, "Rate limit exceeded. Please slow down.", "rate_limited");
      const params = (await ctx.params) as C;
      const out = await handler(req, { user, params });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request.", issues: e.issues.slice(0, 8) }, { status: 400 });
      }
      const msg = e instanceof Error ? e.message : String(e);
      recordUsage({ at: new Date().toISOString(), provider: "trace-api", op: req.nextUrl.pathname, ok: false, ms: Date.now() - started, error: msg });
      console.error("[api]", req.nextUrl.pathname, e);
      return NextResponse.json({ error: "Internal error.", detail: msg.slice(0, 300) }, { status: 500 });
    } finally {
      after(() => flushUsage());
    }
  };
}

export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>, maxBytes = 2_000_000): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "Request body too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "Body must be valid JSON.");
  }
  return schema.parse(raw);
}
