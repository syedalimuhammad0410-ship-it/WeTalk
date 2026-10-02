import "server-only";
import { createHash } from "node:crypto";
import { storage } from "./storage";

interface Entry<T> {
  exp: number;
  v: T;
}

const mem = new Map<string, Entry<unknown>>();
const MEM_MAX = 400;
export const cacheStats = { memHits: 0, storeHits: 0, misses: 0 };

const h = (k: string) => createHash("sha256").update(k).digest("hex").slice(0, 40);

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const k = h(key);
  const m = mem.get(k) as Entry<T> | undefined;
  if (m && m.exp > Date.now()) {
    cacheStats.memHits++;
    return m.v;
  }
  try {
    const e = await storage().getJSON<Entry<T>>(`cache/${k}`);
    if (e && e.exp > Date.now()) {
      cacheStats.storeHits++;
      mem.set(k, e);
      return e.v;
    }
  } catch {
    /* ignore */
  }
  cacheStats.misses++;
  return undefined;
}

export async function cacheSet<T>(key: string, v: T, ttlSeconds: number) {
  const k = h(key);
  const e: Entry<T> = { exp: Date.now() + ttlSeconds * 1000, v };
  mem.set(k, e);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
  try {
    await storage().setJSON(`cache/${k}`, e);
  } catch {
    /* ignore */
  }
}

/** Collapses identical concurrent requests (deduplication). */
const inflight = new Map<string, Promise<unknown>>();
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = h(key);
  const cur = inflight.get(k) as Promise<T> | undefined;
  if (cur) return cur;
  const p = fn().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}
