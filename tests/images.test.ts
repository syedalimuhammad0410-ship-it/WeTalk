import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { imageSize, stripMetadata } from "@/lib/server/images";

// Pure-JS fallback used where sharp is unavailable (Cloudflare Workers).
describe("image metadata fallback", () => {
  const jpg = new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "fixtures/exif-photo.jpg")));
  it("reads dimensions from the header", () => {
    expect(imageSize(jpg)).toEqual({ width: 1280, height: 640 });
  });
  it("strips EXIF (incl. GPS) and the result still decodes", async () => {
    const clean = stripMetadata(jpg);
    expect(Buffer.from(clean).includes(Buffer.from("Exif\0\0"))).toBe(false);
    const meta = await sharp(Buffer.from(clean)).metadata();
    expect([meta.width, meta.height, Boolean(meta.exif)]).toEqual([1280, 640, false]);
  });
});
