import { HttpError, route } from "@/lib/server/api";
import { getInvestigation, imageKeyFor } from "@/lib/server/investigations";
import { sanitizeImage, MAX_UPLOAD_BYTES } from "@/lib/server/images";
import { storage } from "@/lib/server/storage";
import { uid } from "@/lib/util";
import type { ImageRecord } from "@/lib/types";

/**
 * Upload an image binary for an investigation. The client adds the returned
 * ImageRecord to the investigation document (keys are server-issued and owner-scoped).
 */
export const POST = route<{ id: string }>(
  async (req, { user, params }) => {
    const inv = await getInvestigation(user.email, params.id);
    if (inv.images.length >= 24) throw new HttpError(400, "An investigation can hold at most 24 images.");
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_UPLOAD_BYTES + 200_000) throw new HttpError(413, "Image too large.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Missing file field.");
    const clean = await sanitizeImage(await file.arrayBuffer());
    const id = uid("img");
    const key = imageKeyFor(user.email, id);
    await storage().setBinary(key, clean.data, clean.mime);
    const rec: ImageRecord = {
      id,
      name: String(form.get("name") || file.name || "image").slice(0, 120),
      key,
      mime: clean.mime,
      size: clean.data.byteLength,
      width: clean.width || Number(form.get("width") || 0),
      height: clean.height || Number(form.get("height") || 0),
      sha256: clean.sha256,
      createdAt: new Date().toISOString(),
      enhancedFrom: (form.get("enhancedFrom") as string) || undefined,
      enhancements: form.get("enhancements") ? String(form.get("enhancements")).split(",").slice(0, 12) : undefined,
    };
    return { image: rec, sanitized: clean.sanitized };
  },
  { limit: 40, name: "upload" },
);
