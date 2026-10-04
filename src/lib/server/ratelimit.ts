import "./guard";
import { db } from "../db";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter stored in Postgres so it works across instances.
 * Throws RATE_LIMITED when the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, message?: string) {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart")
    VALUES (${key}, 1, ${windowStart})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" = ${windowStart} THEN "RateLimitBucket"."count" + 1 ELSE 1 END,
      "windowStart" = ${windowStart}
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    const retry = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000);
    throw new AppError("RATE_LIMITED", message ?? `Too many requests. Try again in ${retry} seconds.`, { retryAfter: retry });
  }
}
