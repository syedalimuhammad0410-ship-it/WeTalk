import "../guard";
import dns from "node:dns/promises";
import net from "node:net";
import { AppError } from "../errors";

export const AUDIT_USER_AGENT = "WebScoutAI-Audit/1.0 (+website quality review; respects robots.txt)";
export const ROBOTS_TOKEN = "webscoutai-audit";

const MAX_BYTES = 3 * 1024 * 1024;

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

/** SSRF protection: refuse to fetch internal/private network addresses. */
export async function assertPublicHost(url: URL) {
  if (process.env.AUDIT_ALLOW_PRIVATE_HOSTS === "true") return;
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError("BLOCKED", "Only http(s) websites can be analysed.");
  if (url.port && !["80", "443", ""].includes(url.port)) throw new AppError("BLOCKED", "Websites on non-standard ports are not analysed automatically.");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new AppError("BLOCKED", "Internal hostnames cannot be analysed.");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => {
    throw new AppError("NOT_FOUND", `The domain ${host} does not resolve (DNS lookup failed).`);
  });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new AppError("BLOCKED", "This website resolves to a private network address and was not analysed.");
}

export type FetchResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  ms: number;
  redirects: string[];
  truncated: boolean;
};

/** Polite, bounded fetch with manual redirect handling (each hop re-validated). */
export async function politeFetch(rawUrl: string, opts: { timeoutMs?: number; method?: "GET" | "HEAD"; accept?: string } = {}): Promise<FetchResult> {
  const started = Date.now();
  let url = new URL(rawUrl);
  const redirects: string[] = [];
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicHost(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": AUDIT_USER_AGENT, Accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en" },
      });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") throw new AppError("UPSTREAM_TIMEOUT", `The website did not respond within ${Math.round((opts.timeoutMs ?? 12000) / 1000)} seconds.`);
      const cause = ((e as { cause?: { code?: string } }).cause?.code ?? "") as string;
      if (cause === "ENOTFOUND") throw new AppError("NOT_FOUND", `The domain ${url.hostname} does not resolve.`);
      if (cause.startsWith("CERT") || cause.includes("SSL") || cause.includes("TLS") || cause === "DEPTH_ZERO_SELF_SIGNED_CERT" || cause === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
        throw new AppError("UPSTREAM_ERROR", `The website's SSL certificate is invalid (${cause}).`);
      }
      throw new AppError("NETWORK", `Could not connect to ${url.hostname}${cause ? ` (${cause})` : ""}.`);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      if (!loc) break;
      redirects.push(url.toString());
      url = new URL(loc, url);
      continue;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body = "";
    let bytes = 0;
    let truncated = false;
    if (opts.method !== "HEAD" && res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) {
            truncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") throw new AppError("UPSTREAM_TIMEOUT", "The website took too long to send its content.");
        throw e;
      } finally {
        clearTimeout(timer);
      }
      body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    } else clearTimeout(timer);
    return { requestedUrl: rawUrl, finalUrl: url.toString(), status: res.status, headers, body, bytes, ms: Date.now() - started, redirects, truncated };
  }
  throw new AppError("UPSTREAM_ERROR", "The website redirected too many times.");
}
