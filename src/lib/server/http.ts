import "server-only";
import { cacheGet, cacheSet, dedupe } from "./cache";
import { recordUsage } from "./usage";

export const USER_AGENT =
  process.env.TRACE_USER_AGENT || "TRACE-Investigations/1.0 (visual research tool; https://github.com/syedalimuhammad0410-ship-it/WeTalk)";

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

interface FetchOpts {
  provider: string;
  op?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  cacheTtl?: number;
  retries?: number;
  costUnits?: number;
}

/** JSON fetch with timeout, retry on 429/5xx, response caching, dedupe and usage logging. */
export async function fetchJson<T = unknown>(url: string, o: FetchOpts): Promise<{ data: T; cached: boolean; ms: number }> {
  const cacheKey = `${o.method || "GET"} ${url} ${o.body || ""}`;
  if (o.cacheTtl) {
    const hit = await cacheGet<T>(cacheKey);
    if (hit !== undefined) {
      recordUsage({ at: new Date().toISOString(), provider: o.provider, op: o.op || "fetch", ok: true, ms: 0, cached: true });
      return { data: hit, cached: true, ms: 0 };
    }
  }
  return dedupe(cacheKey, async () => {
    const started = Date.now();
    const retries = o.retries ?? 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: o.method || "GET",
          headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(o.headers || {}) },
          body: o.body,
          signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
          cache: "no-store",
        });
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await new Promise((r) => setTimeout(r, (res.status === 429 ? 1500 : 600) * (attempt + 1)));
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const clean = text.trim().startsWith("<") ? "" : text.slice(0, 160);
          throw new ProviderError(o.provider, `${o.provider} responded ${res.status}${res.status === 429 ? " (rate limited — try again shortly)" : clean ? `: ${clean}` : ""}`, res.status);
        }
        const data = (await res.json()) as T;
        const ms = Date.now() - started;
        recordUsage({ at: new Date().toISOString(), provider: o.provider, op: o.op || "fetch", ok: true, status: res.status, ms, costUnits: o.costUnits });
        if (o.cacheTtl) await cacheSet(cacheKey, data, o.cacheTtl);
        return { data, cached: false, ms };
      } catch (e) {
        lastErr = e;
        if (e instanceof ProviderError) break;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 500));
      }
    }
    const ms = Date.now() - started;
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    recordUsage({ at: new Date().toISOString(), provider: o.provider, op: o.op || "fetch", ok: false, ms, error: msg });
    throw lastErr instanceof ProviderError ? lastErr : new ProviderError(o.provider, `${o.provider} unavailable: ${msg}`);
  });
}
