"use client";
import exifr from "exifr";
import type { Box, ExifInfo } from "@/lib/types";

export async function readExif(file: Blob): Promise<ExifInfo | undefined> {
  try {
    const d = await exifr.parse(file, { gps: true, tiff: true, exif: true, pick: ["latitude", "longitude", "DateTimeOriginal", "CreateDate", "Make", "Model", "Software", "Orientation"] });
    if (!d) return undefined;
    const out: ExifInfo = {};
    if (typeof d.latitude === "number" && typeof d.longitude === "number" && !(d.latitude === 0 && d.longitude === 0)) {
      out.lat = d.latitude;
      out.lng = d.longitude;
    }
    const dt = d.DateTimeOriginal || d.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) out.takenAt = dt.toISOString();
    if (d.Make) out.make = String(d.Make);
    if (d.Model) out.model = String(d.Model);
    if (d.Software) out.software = String(d.Software);
    if (d.Orientation) out.orientation = Number(d.Orientation);
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Dominant colours, brightness and a sky-share heuristic (blue/bright pixels in the top third). */
export function colorStats(c: HTMLCanvasElement) {
  const s = document.createElement("canvas");
  s.width = 96;
  s.height = Math.max(1, Math.round((96 * c.height) / c.width));
  const ctx = s.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, s.width, s.height);
  const { data } = ctx.getImageData(0, 0, s.width, s.height);
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let lum = 0;
  let sky = 0;
  let topN = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    lum += 0.299 * r + 0.587 * g + 0.114 * b;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
    const px = i / 4;
    if (Math.floor(px / s.width) < s.height / 3) {
      topN++;
      if ((b > r + 15 && b > g && b > 120) || (r > 200 && g > 200 && b > 200)) sky++;
    }
  }
  const n = data.length / 4;
  const colors = [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((b) => ({ hex: "#" + [b.r / b.n, b.g / b.n, b.b / b.n].map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""), share: b.n / n }));
  return { colors, brightness: lum / n / 255, skyShare: topN ? sky / topN : 0 };
}

export function normBox(x: number, y: number, w: number, h: number, W: number, H: number): Box {
  return { x: Math.max(0, x / W), y: Math.max(0, y / H), w: Math.min(1, w / W), h: Math.min(1, h / H) };
}
