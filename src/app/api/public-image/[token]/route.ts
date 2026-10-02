import { jwtVerify } from "jose";
import { storage } from "@/lib/server/storage";

/**
 * Short-lived, signed, unauthenticated image URL. Used only when the user explicitly
 * runs a third-party reverse-image search that needs to fetch the image (e.g. SerpApi Lens).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { audience: "trace-public-image", issuer: "trace" });
    const key = String(payload.key || "");
    if (!key.startsWith("img/")) throw new Error("bad key");
    const bin = await storage().getBinary(key);
    if (!bin) return new Response("Not found", { status: 404 });
    return new Response(bin.data, { headers: { "Content-Type": bin.mime, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch {
    return new Response("Expired or invalid link", { status: 403 });
  }
}
