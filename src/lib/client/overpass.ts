"use client";
// Overpass (OpenStreetMap query) servers ration slots per IP address, so queries run from the
// user's own browser rather than from shared serverless IPs. All mirrors below send CORS headers.
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

/** Sends the query to several mirrors at once and returns the first good answer. */
export async function overpassQuery<T>(ql: string, timeoutMs = 70000, signal?: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await Promise.any(
      MIRRORS.map(async (ep) => {
        const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(ql)}`, signal: ctl.signal });
        if (!r.ok) throw new Error(`${new URL(ep).hostname} responded ${r.status}`);
        return (await r.json()) as T;
      }),
    );
  } catch (e) {
    throw new Error(e instanceof AggregateError ? "OpenStreetMap query servers are busy or unreachable right now" : e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    ctl.abort();
  }
}
