import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";
import { storage } from "@/lib/server/storage";
import { providerContext } from "@/lib/server/settings";
import { cloudVision } from "@/lib/providers/vision";

/**
 * Server OCR via Google Cloud Vision (when configured). The default OCR engine
 * (Tesseract) runs in the browser; this endpoint is the fallback/second opinion.
 */
export const POST = route(async (req, { user }) => {
  const body = await readJson(req, z.object({ imageKey: z.string().max(200), width: z.number().int().optional(), height: z.number().int().optional() }));
  if (!ownsImageKey(user.email, body.imageKey)) throw new HttpError(404, "Image not found.");
  const bin = await storage().getBinary(body.imageKey);
  if (!bin) throw new HttpError(404, "Image not found.");
  const ctx = await providerContext(user.email);
  const r = await cloudVision(ctx, Buffer.from(bin.data).toString("base64"), body.width || 0, body.height || 0, ["TEXT_DETECTION"]);
  return { status: r.status, error: r.error, text: r.text };
}, { limit: 30, name: "ocr" });
