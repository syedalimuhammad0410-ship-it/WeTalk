import "./guard";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, isAppError } from "./errors";
import { requireAuth, assertCan, type AuthContext } from "./auth";
import { env } from "./env";
import type { Permission } from "../permissions";

type RouteParams = { params: Promise<Record<string, string>> };

type Options = { permission?: Permission; public?: boolean };

export function jsonError(e: unknown) {
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const path = first?.path?.join(".");
    return NextResponse.json(
      { error: { code: "VALIDATION", message: path ? `${path}: ${first!.message}` : first?.message ?? "Invalid input.", issues: e.issues } },
      { status: 400 },
    );
  }
  if (isAppError(e)) {
    const headers: Record<string, string> = {};
    const retry = (e.details as { retryAfter?: number } | undefined)?.retryAfter;
    if (retry) headers["Retry-After"] = String(retry);
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return NextResponse.json({ error: { code: "CONFLICT", message: "A record with these details already exists." } }, { status: 409 });
    if (e.code === "P2025") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Record not found." } }, { status: 404 });
  }
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected server error. The action was not completed; please retry." } }, { status: 500 });
}

/** CSRF defence: state-changing requests must originate from our own origin. */
export function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) {
    // Browsers always send Origin on cross-site POSTs; same-origin fetches send it too.
    // Requests without Origin are non-browser clients (no ambient cookies risk) — allow in dev/tests only when explicitly marked.
    if (req.headers.get("x-requested-with") === "webscout") return;
    throw new AppError("FORBIDDEN", "Missing Origin header.");
  }
  const allowed = new Set([new URL(env.appUrl()).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
}

export function api<T>(
  opts: Options,
  fn: (req: NextRequest, ctx: AuthContext, params: Record<string, string>) => Promise<T | NextResponse>,
) {
  return async (req: NextRequest, route: RouteParams) => {
    try {
      checkOrigin(req);
      const ctx = await requireAuth();
      if (opts.permission) assertCan(ctx, opts.permission);
      const params = (await route?.params) ?? {};
      const result = await fn(req, ctx, params);
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return jsonError(e);
    }
  };
}

export function publicApi<T>(fn: (req: NextRequest, params: Record<string, string>) => Promise<T | NextResponse>, { csrf = true } = {}) {
  return async (req: NextRequest, route: RouteParams) => {
    try {
      if (csrf) checkOrigin(req);
      const params = (await route?.params) ?? {};
      const result = await fn(req, params);
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return jsonError(e);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const obj: Record<string, string | string[]> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (obj[k] === undefined) obj[k] = v;
    else obj[k] = ([] as string[]).concat(obj[k] as string[], v);
  });
  return schema.parse(obj);
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
