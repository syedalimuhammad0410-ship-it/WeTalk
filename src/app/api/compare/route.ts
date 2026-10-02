import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";
import { storage } from "@/lib/server/storage";
import { providerContext } from "@/lib/server/settings";
import { aiProvider } from "@/lib/providers/ai";
import { USER_AGENT } from "@/lib/server/http";

/**
 * AI-assisted visual comparison between the uploaded image and a candidate reference
 * photo (Wikimedia hosts only). Pixel/embedding comparison runs in the browser; this adds
 * a feature-level description when an AI provider is configured.
 */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, z.object({ imageKey: z.string().max(200), referenceUrl: z.string().url().max(1000), context: z.string().max(500) }));
  if (!ownsImageKey(user.email, b.imageKey)) throw new HttpError(404, "Image not found.");
  const ref = new URL(b.referenceUrl);
  if (!/(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/.test(ref.hostname)) throw new HttpError(403, "Reference host not allowed.");
  const ai = aiProvider(await providerContext(user.email));
  if (!ai.configured()) return { status: "not_configured", error: "AI comparison requires ANTHROPIC_API_KEY. In-browser visual similarity is still computed." };
  const bin = await storage().getBinary(b.imageKey);
  if (!bin) throw new HttpError(404, "Image not found.");
  const res = await fetch(ref, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(12000) });
  if (!res.ok || !(res.headers.get("content-type") || "").startsWith("image/")) throw new HttpError(502, "Could not load reference image.");
  const refBuf = Buffer.from(await res.arrayBuffer());
  try {
    const r = await ai.compareImages(
      { base64: Buffer.from(bin.data).toString("base64"), mime: bin.mime },
      { base64: refBuf.toString("base64"), mime: (res.headers.get("content-type") || "image/jpeg").split(";")[0] },
      b.context,
    );
    return { status: "ok", model: ai.model, ...r };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}, { limit: 20, name: "compare" });
