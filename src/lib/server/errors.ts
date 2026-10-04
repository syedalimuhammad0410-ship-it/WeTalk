/**
 * Typed application errors. `message` is always safe to show to the user and
 * should explain what happened and what (if anything) was changed.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "INVALID_CREDENTIALS"
  | "QUOTA_EXCEEDED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "BLOCKED"
  | "MALFORMED_RESPONSE"
  | "NETWORK"
  | "SUPPRESSED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  NOT_CONFIGURED: 412,
  INVALID_CREDENTIALS: 424,
  QUOTA_EXCEEDED: 429,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  BLOCKED: 451,
  MALFORMED_RESPONSE: 502,
  NETWORK: 503,
  SUPPRESSED: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export function describeError(e: unknown): string {
  if (isAppError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Wraps a fetch call with a timeout and maps network failures to AppErrors. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number; service: string },
): Promise<Response> {
  const { timeoutMs = 15000, service, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new AppError("UPSTREAM_TIMEOUT", `${service} did not respond within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new AppError("NETWORK", `Could not reach ${service}: ${(e as Error)?.message ?? "network error"}.`);
  } finally {
    clearTimeout(timer);
  }
}
