import "server-only";
import { createHash } from "node:crypto";
import { HttpError } from "./api";

export const MAX_UPLOAD_BYTES = 4_500_000; // stays under the 6 MB serverless request limit

export function sniffMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  return null;
}

export interface CleanImage {
  data: ArrayBuffer;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  sanitized: boolean;
}

/**
 * Validates magic bytes, then re-encodes the image (strips embedded payloads,
 * metadata and polyglot content) and bounds its dimensions.
 */
export async function sanitizeImage(input: ArrayBuffer, maxDim = 2560): Promise<CleanImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, `Image too large (max ${(MAX_UPLOAD_BYTES / 1e6).toFixed(1)} MB after client-side compression).`);
  const bytes = new Uint8Array(input);
  const mime = sniffMime(bytes);
  if (!mime) throw new HttpError(415, "Unsupported file type. Upload JPEG, PNG, WebP or GIF images.");
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(Buffer.from(bytes), { limitInputPixels: 80_000_000, animated: false }).rotate();
    const meta = await img.metadata();
    const outMime = mime === "image/png" ? "image/png" : "image/jpeg";
    const pipeline = img.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });
    const out = outMime === "image/png" ? await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    void meta;
    const ab = out.data.buffer.slice(out.data.byteOffset, out.data.byteOffset + out.data.byteLength) as ArrayBuffer;
    return { data: ab, mime: outMime, width: out.info.width, height: out.info.height, sha256: createHash("sha256").update(out.data).digest("hex"), sanitized: true };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // sharp unavailable or failed to decode: accept validated original bytes
    console.warn("[images] sanitize fallback:", e instanceof Error ? e.message : e);
    return { data: input, mime, width: 0, height: 0, sha256: createHash("sha256").update(bytes).digest("hex"), sanitized: false };
  }
}
