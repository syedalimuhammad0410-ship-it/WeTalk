import "server-only";
import { storage } from "./storage";

const buckets = new Map<string, { count: number; reset: number }>();

/** Fixed-window in-memory limiter (per function instance). */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1, reset: now + windowMs };
  }
  b.count++;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), reset: b.reset };
}

/** Durable limiter for login attempts (shared across instances via storage). */
export async function durableAttempt(key: string, limit: number, windowMs: number) {
  const k = `ratelimit/${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
  const now = Date.now();
  const s = storage();
  const cur = (await s.getJSON<{ count: number; reset: number }>(k)) || { count: 0, reset: now + windowMs };
  if (cur.reset < now) {
    cur.count = 0;
    cur.reset = now + windowMs;
  }
  cur.count++;
  await s.setJSON(k, cur);
  return { ok: cur.count <= limit, retryAfterSec: Math.ceil((cur.reset - now) / 1000) };
}

export async function clearAttempts(key: string) {
  await storage().delete(`ratelimit/${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}`);
}
