import "server-only";
import { HttpError } from "./api";
import { storage } from "./storage";

/** Loads a stored image as base64 JPEG (≤1568px), optionally cropped to a normalised region. */
export async function loadBase64(key: string, region?: { x: number; y: number; w: number; h: number }) {
  const bin = await storage().getBinary(key);
  if (!bin) throw new HttpError(404, "Image not found.");
  let buf = Buffer.from(bin.data);
  let mime = bin.mime;
  let width = 0;
  let height = 0;
  try {
    const sharp = (await import("sharp")).default;
    let img = sharp(buf);
    const meta = await img.metadata();
    width = meta.width || 0;
    height = meta.height || 0;
    if (region && width && height) {
      const left = Math.round(region.x * width);
      const top = Math.round(region.y * height);
      img = img.extract({ left, top, width: Math.max(8, Math.min(width - left, Math.round(region.w * width))), height: Math.max(8, Math.min(height - top, Math.round(region.h * height))) });
    }
    const out = await img.resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
    buf = out.data;
    mime = "image/jpeg";
    width = out.info.width;
    height = out.info.height;
  } catch {
    /* use original */
  }
  return { base64: buf.toString("base64"), mime, width, height };
}
