"use client";
import type { Box, OcrLine } from "@/lib/types";
import { uid } from "@/lib/util";
import { ocrPreprocess, upscaleCanvas } from "./image";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let workerP: Promise<TWorker> | null = null;

async function worker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, { logger: () => undefined });
    })().catch((e) => {
      workerP = null;
      throw e;
    });
  }
  return workerP;
}

const CONFUSIONS: [RegExp, string][] = [
  [/0/g, "O"],
  [/1/g, "I"],
  [/5/g, "S"],
  [/8/g, "B"],
  [/\|/g, "I"],
];

function corrections(text: string): string[] {
  const out = new Set<string>();
  if (/[A-Za-z]/.test(text) && /[0-9|]/.test(text)) {
    let t = text;
    for (const [re, rep] of CONFUSIONS) t = t.replace(re, rep);
    if (t !== text) out.add(t);
  }
  const titled = text.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
  if (text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) out.add(titled);
  return [...out].slice(0, 3);
}

function clean(s: string) {
  return s.replace(/[^\p{L}\p{N}&'.,:\-/@#() ]+/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * Tesseract OCR with two passes (natural + contrast-normalised, upscaled) and region
 * offsets. Lines below 60% confidence are flagged as uncertain, never silently trusted.
 */
export async function runOcr(
  canvas: HTMLCanvasElement,
  opts: { source: OcrLine["source"]; region?: Box; passes?: number; onProgress?: (p: string) => void } = { source: "original" },
): Promise<OcrLine[]> {
  const w = await worker();
  const variants: HTMLCanvasElement[] = [upscaleCanvas(canvas, 1400)];
  if ((opts.passes ?? 2) > 1) variants.push(ocrPreprocess(upscaleCanvas(canvas, 1800)));
  const lines: OcrLine[] = [];
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    opts.onProgress?.(vi === 0 ? "reading text" : "reading text (contrast-normalised pass)");
    const { data } = await w.recognize(v, {}, { blocks: true, text: true });
    for (const b of data.blocks || [])
      for (const p of b.paragraphs)
        for (const l of p.lines) {
          // rebuild the line from confidently-read words only (photos produce many noise glyphs)
          const good = (l.words || []).filter((w) => w.confidence >= 55 && /[\p{L}\p{N}]{2,}/u.test(w.text));
          const text = clean(good.length ? good.map((w) => w.text).join(" ") : l.text);
          if (!good.some((w) => /\p{L}{3,}|\d{3,}/u.test(w.text))) continue;
          if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) continue;
          // discard lines that are mostly noise symbols
          const alnum = text.replace(/[^\p{L}\p{N}]/gu, "").length / text.length;
          if (alnum < 0.55) continue;
          if (l.confidence < 30) continue;
          let box: Box = { x: l.bbox.x0 / v.width, y: l.bbox.y0 / v.height, w: (l.bbox.x1 - l.bbox.x0) / v.width, h: (l.bbox.y1 - l.bbox.y0) / v.height };
          if (opts.region) box = { x: opts.region.x + box.x * opts.region.w, y: opts.region.y + box.y * opts.region.h, w: box.w * opts.region.w, h: box.h * opts.region.h };
          const existing = lines.find((x) => x.text.toLowerCase() === text.toLowerCase());
          if (existing) {
            existing.confidence = Math.max(existing.confidence, l.confidence);
            existing.uncertain = existing.confidence < 60;
            continue;
          }
          lines.push({ id: uid("ocr"), text, confidence: Math.round(l.confidence), box, source: opts.source, engine: vi === 0 ? "tesseract" : "tesseract+normalize", uncertain: l.confidence < 60, corrections: corrections(text) });
        }
  }
  return lines.sort((a, b) => b.confidence - a.confidence).slice(0, 60);
}
