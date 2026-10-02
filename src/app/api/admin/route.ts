import { requireOwner, route } from "@/lib/server/api";
import { recentUsage, type UsageEvent } from "@/lib/server/usage";
import { cacheStats } from "@/lib/server/cache";
import { storage } from "@/lib/server/storage";

/** Developer/admin diagnostics: API calls, errors, latency, cache hits, cost units. */
export const GET = route(async (_req, { user }) => {
  requireOwner(user);
  const s = storage();
  const days: Record<string, unknown> = {};
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    const v = await s.getJSON(`usage/day/${d}`).catch(() => null);
    if (v) days[d] = v;
  }
  const errors = ((await s.getJSON<UsageEvent[]>("usage/errors").catch(() => null)) || []).slice(-50).reverse();
  return {
    storage: s.name,
    instance: { recent: recentUsage().slice(0, 150), cache: cacheStats, uptimeSec: Math.round(process.uptime()), node: process.version },
    days,
    errors,
  };
});
