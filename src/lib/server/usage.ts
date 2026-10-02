import "server-only";
import { storage } from "./storage";

export interface UsageEvent {
  at: string;
  provider: string;
  op: string;
  ok: boolean;
  status?: number;
  ms: number;
  cached?: boolean;
  error?: string;
  costUnits?: number;
}

const RING: UsageEvent[] = [];
const MAX = 600;
let pending: Record<string, { calls: number; errors: number; cached: number; ms: number; cost: number }> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const errorQueue: UsageEvent[] = [];

export function recordUsage(e: UsageEvent) {
  RING.push(e);
  if (RING.length > MAX) RING.shift();
  const k = e.provider;
  const p = (pending[k] ||= { calls: 0, errors: 0, cached: 0, ms: 0, cost: 0 });
  p.calls++;
  if (!e.ok) p.errors++;
  if (e.cached) p.cached++;
  p.ms += e.ms;
  p.cost += e.costUnits || 0;
  if (!e.ok) errorQueue.push(e);
  if (!flushTimer) flushTimer = setTimeout(() => void flushUsage(), 1500);
}

export async function flushUsage() {
  flushTimer = null;
  const batch = pending;
  pending = {};
  const errs = errorQueue.splice(0);
  if (!Object.keys(batch).length && !errs.length) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = `usage/day/${day}`;
    const s = storage();
    const cur = ((await s.getJSON<Record<string, { calls: number; errors: number; cached: number; ms: number; cost: number }>>(key)) || {}) as Record<
      string,
      { calls: number; errors: number; cached: number; ms: number; cost: number }
    >;
    for (const [k, v] of Object.entries(batch)) {
      const c = (cur[k] ||= { calls: 0, errors: 0, cached: 0, ms: 0, cost: 0 });
      c.calls += v.calls;
      c.errors += v.errors;
      c.cached += v.cached;
      c.ms += v.ms;
      c.cost += v.cost;
    }
    await s.setJSON(key, cur);
    if (errs.length) {
      const ek = "usage/errors";
      const list = ((await s.getJSON<UsageEvent[]>(ek)) || []).concat(errs).slice(-200);
      await s.setJSON(ek, list);
    }
  } catch {
    // metrics are best-effort; never break a request
  }
}

export function recentUsage() {
  return [...RING].reverse();
}
