import "../guard";
import { fetchWithTimeout } from "../errors";
import type { Psi } from "./score";

/**
 * Google PageSpeed Insights (Lighthouse, mobile). Optional: requires the
 * PageSpeed Insights API to be enabled for the configured Google API key.
 * Returns { psi: null, note } on any failure — the audit continues without it.
 */
export async function runPageSpeed(url: string, apiKey: string | null): Promise<{ psi: Psi | null; note: string | null }> {
  if (!apiKey) return { psi: null, note: "Lighthouse metrics skipped (no Google API key configured)." };
  const qs = new URLSearchParams({ url, strategy: "mobile", key: apiKey });
  ["performance", "accessibility", "seo", "best-practices"].forEach((c) => qs.append("category", c));
  try {
    const res = await fetchWithTimeout(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { service: "Google PageSpeed Insights", timeoutMs: 70000 });
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      lighthouseResult?: { categories?: Record<string, { score: number | null }>; audits?: Record<string, { numericValue?: number }> };
    } | null;
    if (!res.ok || !data?.lighthouseResult) {
      return { psi: null, note: `Lighthouse metrics unavailable: ${data?.error?.message?.slice(0, 160) ?? `HTTP ${res.status}`}` };
    }
    const cat = data.lighthouseResult.categories ?? {};
    const a = data.lighthouseResult.audits ?? {};
    const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));
    return {
      psi: {
        performance: pct(cat.performance?.score),
        accessibility: pct(cat.accessibility?.score),
        seo: pct(cat.seo?.score),
        bestPractices: pct(cat["best-practices"]?.score),
        metrics: {
          lcpMs: a["largest-contentful-paint"]?.numericValue,
          cls: a["cumulative-layout-shift"]?.numericValue,
          tbtMs: a["total-blocking-time"]?.numericValue,
          fcpMs: a["first-contentful-paint"]?.numericValue,
          speedIndexMs: a["speed-index"]?.numericValue,
        },
      },
      note: null,
    };
  } catch (e) {
    return { psi: null, note: `Lighthouse metrics unavailable: ${(e as Error).message}` };
  }
}
