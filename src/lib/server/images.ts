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

/** Pixel dimensions from the file header (JPEG/PNG/GIF/WebP), without decoding. */
export function imageSize(b: Uint8Array): { width: number; height: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (b[0] === 0x47 && b[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (b[0] === 0x52 && b[8] === 0x57) {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (fourcc === "VP8L") return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
      if (fourcc === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return { width: 0, height: 0 };
        const m = b[i + 1];
        const len = dv.getUint16(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
        i += 2 + len;
      }
    }
  } catch {
    /* truncated header */
  }
  return { width: 0, height: 0 };
}

/**
 * Removes metadata without re-encoding: JPEG APP1 (EXIF/XMP, incl. GPS), APP13 (IPTC) and comments;
 * PNG text/EXIF chunks. Used where native image libraries are unavailable (e.g. Cloudflare Workers).
 */
export function stripMetadata(b: Uint8Array): Uint8Array {
  if (b[0] === 0xff && b[1] === 0xd8) {
    const out: Uint8Array[] = [b.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xda) break; // start of scan: the rest is image data
      const len = (b[i + 2] << 8) | b[i + 3];
      const drop = m === 0xe1 || m === 0xed || m === 0xfe || (m >= 0xe3 && m <= 0xef && m !== 0xee);
      if (!drop) out.push(b.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    out.push(b.subarray(i));
    const total = out.reduce((n, p) => n + p.length, 0);
    const res = new Uint8Array(total);
    let o = 0;
    for (const p of out) {
      res.set(p, o);
      o += p.length;
    }
    return res;
  }
  if (b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out: Uint8Array[] = [b.subarray(0, 8)];
    let i = 8;
    while (i + 12 <= b.length) {
      const len = dv.getUint32(i);
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (!["tEXt", "iTXt", "zTXt", "eXIf", "tIME"].includes(type)) out.push(b.subarray(i, i + 12 + len));
      i += 12 + len;
    }
    const res = new Uint8Array(out.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of out) {
      res.set(p, o);
      o += p.length;
    }
    return res;
  }
  return b;
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
    // sharp unavailable (e.g. Cloudflare Workers) or failed to decode: strip metadata from the validated bytes
    console.warn("[images] sanitize fallback:", e instanceof Error ? e.message : e);
    const clean = stripMetadata(bytes);
    const { width, height } = imageSize(clean);
    const data = clean.buffer.slice(clean.byteOffset, clean.byteOffset + clean.byteLength) as ArrayBuffer;
    return { data, mime, width, height, sha256: createHash("sha256").update(clean).digest("hex"), sanitized: clean.length !== bytes.length };
  }
}
