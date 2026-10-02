// Isomorphic helpers (safe in browser + server).

export function uid(prefix = ""): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  return prefix ? `${prefix}_${s}` : s;
}

export const nowIso = () => new Date().toISOString();

export function clamp(n: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, n));
}

/** Uppercase/accents/punctuation-insensitive normal form. */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function compact(s: string): string {
  return norm(s).replace(/\s+/g, "");
}

function trigrams(s: string): Set<string> {
  const t = `  ${compact(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * How well a fragment of OCR text supports a name.
 * Handles partial reads (e.g. "IPS ARENA" vs "Philips Arena") without treating
 * tiny fragments as matches.
 */
export function textSupport(ocr: string, name: string): { score: number; how: string } {
  const o = compact(ocr);
  const n = compact(name);
  if (!o || !n) return { score: 0, how: "" };
  if (o === n) return { score: 1, how: "exact" };
  if (o.length >= 4 && n.includes(o)) {
    return { score: Math.min(0.95, 0.45 + (o.length / n.length) * 0.55), how: "partial (text is a fragment of the name)" };
  }
  if (n.length >= 4 && o.includes(n)) return { score: 0.9, how: "name contained in text" };
  const d = levenshtein(o, n);
  const lev = 1 - d / Math.max(o.length, n.length);
  const tri = trigramSimilarity(ocr, name);
  const score = Math.max(lev > 0.75 ? lev : 0, tri > 0.45 ? tri : 0);
  return { score, how: score ? "fuzzy" : "" };
}

export function yearOf(s?: string | null): number | undefined {
  if (!s) return undefined;
  const m = String(s).match(/(1[6-9]\d\d|20\d\d)/);
  return m ? Number(m[1]) : undefined;
}

export function uniqBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of arr) {
    const k = key(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
