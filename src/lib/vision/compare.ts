"use client";
import type { Box, Strength, VisualComparison } from "@/lib/types";
import { cosine } from "./clip";

function hist(c: HTMLCanvasElement, box?: Box) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const x = Math.floor((box?.x || 0) * c.width);
  const y = Math.floor((box?.y || 0) * c.height);
  const w = Math.max(1, Math.floor((box?.w || 1) * c.width));
  const h = Math.max(1, Math.floor((box?.h || 1) * c.height));
  const { data } = ctx.getImageData(x, y, w, h);
  const H = new Float32Array(8 * 4 * 4);
  const G = new Float32Array(8); // gradient orientation histogram
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let hue = 0;
    if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = ((hue * 60 + 360) % 360) / 360;
    const sat = max ? d / max : 0;
    H[Math.min(7, Math.floor(hue * 8)) * 16 + Math.min(3, Math.floor(sat * 4)) * 4 + Math.min(3, Math.floor(max * 4))]++;
    gray[j] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  for (let yy = 1; yy < h - 1; yy++)
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      const mag = Math.hypot(gx, gy);
      if (mag < 0.08) continue;
      const ang = (Math.atan2(gy, gx) + Math.PI) % Math.PI;
      G[Math.min(7, Math.floor((ang / Math.PI) * 8))] += mag;
    }
  const n = data.length / 4;
  for (let i = 0; i < H.length; i++) H[i] /= n;
  const gs = G.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 8; i++) G[i] /= gs;
  return { H, G };
}

const intersect = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
};

function small(src: HTMLCanvasElement, w = 256) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = Math.round((w * src.height) / src.width) || w;
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/**
 * Real pixel-level comparison between the investigated image and a reference photo:
 *  - CLIP embedding cosine similarity (semantic/visual content)
 *  - HSV colour-histogram intersection
 *  - edge-orientation histogram similarity (structure/geometry)
 *  - per-cell (4×4 grid) similarity to highlight areas that look alike
 * Results are labelled strong / moderate / weak / none — never a fake percentage.
 */
export function compareCanvases(a: HTMLCanvasElement, b: HTMLCanvasElement, embA?: Float32Array, embB?: Float32Array): VisualComparison {
  const A = small(a);
  const B = small(b);
  const ha = hist(A);
  const hb = hist(B);
  const color = intersect(ha.H, hb.H);
  const structure = intersect(ha.G, hb.G);
  const embedding = embA && embB ? cosine(embA, embB) : undefined;
  const cells: { box: Box; score: number }[] = [];
  for (let gy = 0; gy < 4; gy++)
    for (let gx = 0; gx < 4; gx++) {
      const box = { x: gx / 4, y: gy / 4, w: 0.25, h: 0.25 };
      const ca = hist(A, box);
      const cb = hist(B, box);
      cells.push({ box, score: 0.5 * intersect(ca.H, cb.H) + 0.5 * intersect(ca.G, cb.G) });
    }
  const notes: string[] = [];
  let overall: Strength | "none";
  if (embedding !== undefined) {
    overall = embedding >= 0.86 ? "strong" : embedding >= 0.79 ? "moderate" : embedding >= 0.71 ? "weak" : "none";
    notes.push(embedding >= 0.79 ? "overall scene content closely aligned" : embedding >= 0.71 ? "similar type of scene" : "different-looking scene");
  } else {
    const s = 0.5 * color + 0.5 * structure;
    overall = s >= 0.8 ? "moderate" : s >= 0.65 ? "weak" : "none";
    notes.push("embedding unavailable — colour/structure only");
  }
  if (color >= 0.6) notes.push("similar colour palette");
  if (structure >= 0.85) notes.push("similar line/edge geometry");
  const strongCells = cells.filter((c) => c.score >= 0.75).length;
  if (strongCells >= 4) notes.push(`${strongCells} of 16 regions look alike`);
  return {
    comparedAt: new Date().toISOString(),
    method: ["clip-embedding", "hsv-histogram", "edge-orientation", "grid-regions"].filter((m) => m !== "clip-embedding" || embedding !== undefined),
    embedding,
    color,
    structure,
    overall,
    cells,
    notes,
  };
}
