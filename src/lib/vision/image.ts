"use client";
import type { Box } from "@/lib/types";

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${src.slice(0, 80)}`));
    img.src = src;
  });
}

export function toCanvas(img: CanvasImageSource & { width: number; height: number }, maxDim = 1600, box?: Box): HTMLCanvasElement {
  const iw = (img as HTMLImageElement).naturalWidth || img.width;
  const ih = (img as HTMLImageElement).naturalHeight || img.height;
  const sx = box ? box.x * iw : 0;
  const sy = box ? box.y * ih : 0;
  const sw = box ? box.w * iw : iw;
  const sh = box ? box.h * ih : ih;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

export function upscaleCanvas(src: HTMLCanvasElement, minWidth: number): HTMLCanvasElement {
  if (src.width >= minWidth) return src;
  const f = minWidth / src.width;
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * f);
  c.height = Math.round(src.height * f);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Grayscale + contrast stretch, a classic OCR pre-processing step. */
export function ocrPreprocess(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  let lo = 255;
  let hi = 0;
  const g = new Uint8ClampedArray(p.length / 4);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    g[j] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const v = ((g[j] - lo) / span) * 255;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** Client-side compression before upload: bounded dimensions, JPEG, ≤ ~3.8 MB. */
export async function compressForUpload(file: Blob, maxDim = 2400): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let dim = maxDim;
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = toCanvas(img, dim);
      const keepPng = file.type === "image/png" && file.size < 2_500_000 && attempt === 0;
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), keepPng ? "image/png" : "image/jpeg", 0.9 - attempt * 0.08));
      if (blob.size < 3_800_000) return { blob, width: c.width, height: c.height };
      dim = Math.round(dim * 0.8);
    }
    throw new Error("Image could not be compressed below the upload limit.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/jpeg", q = 0.92): Promise<Blob> {
  return new Promise((r) => c.toBlob((b) => r(b!), type, q));
}

/** Perspective correction: maps the quadrilateral `quad` (normalized TL,TR,BR,BL) to a rectangle. */
export function perspectiveWarp(src: HTMLCanvasElement, quad: { x: number; y: number }[], outW?: number, outH?: number): HTMLCanvasElement {
  const P = quad.map((q) => ({ x: q.x * src.width, y: q.y * src.height }));
  const w = outW || Math.round(Math.max(Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y), Math.hypot(P[2].x - P[3].x, P[2].y - P[3].y)));
  const h = outH || Math.round(Math.max(Math.hypot(P[3].x - P[0].x, P[3].y - P[0].y), Math.hypot(P[2].x - P[1].x, P[2].y - P[1].y)));
  // homography from destination rect -> source quad
  const dst = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = P[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const hm = solve(A, b);
  const H = [...hm, 1];
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  const od = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const den = H[6] * x + H[7] * y + H[8];
      const u = Math.round((H[0] * x + H[1] * y + H[2]) / den);
      const v = Math.round((H[3] * x + H[4] * y + H[5]) / den);
      if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
      const si = (v * src.width + u) * 4;
      const oi = (y * w + x) * 4;
      od.data[oi] = sd[si];
      od.data[oi + 1] = sd[si + 1];
      od.data[oi + 2] = sd[si + 2];
      od.data[oi + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
