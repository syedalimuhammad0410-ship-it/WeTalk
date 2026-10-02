import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";
import { storage } from "@/lib/server/storage";

const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("sharpen"), amount: z.number().min(0.3).max(4).default(1.2) }),
  z.object({ op: z.literal("denoise"), size: z.number().int().min(3).max(7).default(3) }),
  z.object({ op: z.literal("contrast"), amount: z.number().min(0.5).max(2.5).default(1.3) }),
  z.object({ op: z.literal("brightness"), amount: z.number().min(0.4).max(2.2).default(1.15) }),
  z.object({ op: z.literal("normalize") }),
  z.object({ op: z.literal("upscale"), factor: z.number().min(1.25).max(4).default(2) }),
  z.object({ op: z.literal("grayscale") }),
  z.object({ op: z.literal("threshold"), level: z.number().int().min(40).max(220).default(140) }),
  z.object({ op: z.literal("rotate"), degrees: z.number().min(-180).max(180) }),
  z.object({ op: z.literal("crop"), x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.02).max(1), h: z.number().min(0.02).max(1) }),
  z.object({ op: z.literal("deblur"), sigma: z.number().min(0.5).max(3).default(1.5) }),
]);

/**
 * Classical image enhancement (sharp/libvips). These operations only redistribute
 * information already present in the pixels; they cannot recover detail that was never
 * captured. The UI shows original and enhanced side by side and labels enhanced OCR.
 */
export const POST = route(async (req, { user }) => {
  const body = await readJson(req, z.object({ imageKey: z.string().max(200), ops: z.array(Op).min(1).max(12) }));
  if (!ownsImageKey(user.email, body.imageKey)) throw new HttpError(404, "Image not found.");
  const bin = await storage().getBinary(body.imageKey);
  if (!bin) throw new HttpError(404, "Image not found.");
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new HttpError(503, "Server enhancement engine unavailable; use in-browser enhancement.");
  }
  let buf = Buffer.from(bin.data);
  for (const o of body.ops) {
    let img = sharp(buf);
    const meta = await img.metadata();
    const w = meta.width || 1;
    const h = meta.height || 1;
    switch (o.op) {
      case "sharpen":
        img = img.sharpen({ sigma: o.amount });
        break;
      case "deblur": // unsharp-mask style deconvolution approximation
        img = img.sharpen({ sigma: o.sigma, m1: 1.5, m2: 3 });
        break;
      case "denoise":
        img = img.median(o.size);
        break;
      case "contrast":
        img = img.linear(o.amount, -(128 * o.amount) + 128);
        break;
      case "brightness":
        img = img.modulate({ brightness: o.amount });
        break;
      case "normalize":
        img = img.normalize();
        break;
      case "upscale":
        if (w * o.factor > 6000 || h * o.factor > 6000) throw new HttpError(400, "Upscaled image would exceed 6000px.");
        img = img.resize({ width: Math.round(w * o.factor), kernel: "lanczos3" });
        break;
      case "grayscale":
        img = img.grayscale();
        break;
      case "threshold":
        img = img.grayscale().threshold(o.level);
        break;
      case "rotate":
        img = img.rotate(o.degrees, { background: "#000000" });
        break;
      case "crop": {
        const left = Math.round(o.x * w);
        const top = Math.round(o.y * h);
        img = img.extract({ left, top, width: Math.max(4, Math.min(w - left, Math.round(o.w * w))), height: Math.max(4, Math.min(h - top, Math.round(o.h * h))) });
        break;
      }
    }
    buf = await img.png().toBuffer();
  }
  const out = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
  if (out.byteLength > 4_400_000) throw new HttpError(413, "Enhanced image is too large; crop first or reduce upscale factor.");
  return new Response(new Uint8Array(out), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Enhancements": body.ops.map((o) => o.op).join(",") } });
}, { limit: 40, name: "enhance" });
