import { HttpError, route } from "@/lib/server/api";
import { USER_AGENT } from "@/lib/server/http";

// Only public, licensed image hosts used for candidate reference photos.
const ALLOWED = [/^(upload|commons|thumb)\.wikimedia\.org$/, /^[a-z]+\.wikipedia\.org$/, /^tile\.openstreetmap\.org$/, /^server\.arcgisonline\.com$/];
const MAX = 10_000_000;

export const GET = route(async (req) => {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) throw new HttpError(400, "Missing url.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "Invalid url.");
  }
  if (u.protocol !== "https:" || !ALLOWED.some((r) => r.test(u.hostname))) throw new HttpError(403, "Host not allowed by image proxy.");
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(u, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  if (!res) throw new HttpError(502, "Upstream unavailable.");
  const final = new URL(res.url);
  if (!ALLOWED.some((r) => r.test(final.hostname))) throw new HttpError(403, "Redirected to a host that is not allowed.");
  if (!res.ok) throw new HttpError(502, `Upstream responded ${res.status}.`);
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new HttpError(415, "Upstream is not an image.");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX) throw new HttpError(413, "Upstream image too large.");
  return new Response(buf, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}, { limit: 300, name: "image-proxy" });
