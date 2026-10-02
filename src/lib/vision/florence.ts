"use client";
// Scene-text OCR with Florence-2 (Microsoft, MIT licence) running in the browser via
// transformers.js. Far more robust than Tesseract on photos (signs, neon, scoreboards).
// The model (~275 MB quantised) is downloaded once and cached by the browser.
import type { Box, OcrLine } from "@/lib/types";
import { uid } from "@/lib/util";
import { transformers } from "./clip";

const MODEL = "onnx-community/Florence-2-base-ft";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let loadP: Promise<{ model: Any; processor: Any; device: string }> | null = null;

export function loadFlorence(onProgress?: (msg: string) => void) {
  if (!loadP) {
    loadP = (async () => {
      const T = await transformers();
      const files = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.file && p.total) {
          files.set(p.file, { loaded: p.loaded || 0, total: p.total });
          const tot = [...files.values()].reduce((a, b) => a + b.total, 0);
          const got = [...files.values()].reduce((a, b) => a + b.loaded, 0);
          onProgress?.(`Downloading scene-text OCR model ${Math.round((got / tot) * 100)}% (${Math.round(tot / 1e6)} MB, cached after first use)`);
        }
      };
      const processor = await T.AutoProcessor.from_pretrained(MODEL);
      const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
      if (nav.gpu && (await nav.gpu.requestAdapter().catch(() => null))) {
        try {
          const model = await T.Florence2ForConditionalGeneration.from_pretrained(MODEL, {
            device: "webgpu",
            dtype: { embed_tokens: "fp16", vision_encoder: "fp16", encoder_model: "q4", decoder_model_merged: "q4" },
            progress_callback,
          });
          return { model, processor, device: "webgpu" };
        } catch {
          /* fall back to wasm */
        }
      }
      const model = await T.Florence2ForConditionalGeneration.from_pretrained(MODEL, { dtype: "q8", progress_callback });
      return { model, processor, device: "wasm" };
    })();
    loadP.catch(() => (loadP = null));
  }
  return loadP;
}

function quadToBox(q: number[], W: number, H: number): Box {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  return { x: x / W, y: y / H, w: (Math.max(...xs) - x) / W, h: (Math.max(...ys) - y) / H };
}

async function ocrCanvas(c: HTMLCanvasElement) {
  const { model, processor } = await loadFlorence();
  const T = await transformers();
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.92));
  const image = await T.RawImage.fromBlob(blob);
  const task = "<OCR_WITH_REGION>";
  const inputs = await processor(image, processor.construct_prompts(task));
  const ids = await model.generate({ ...inputs, max_new_tokens: 192 });
  const text = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  const parsed = processor.post_process_generation(text, task, image.size)[task] as { labels: string[]; quad_boxes: number[][] };
  return parsed.labels.map((label, i) => ({ text: label.replace(/<\/?s>/g, "").trim(), box: quadToBox(parsed.quad_boxes[i], c.width, c.height) })).filter((l) => l.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
}

/**
 * Runs Florence-2 OCR on the full frame and (optionally) on overlapping tiles so small
 * text gets more pixels. Florence does not report confidences; lines seen in more than
 * one pass get a higher weight, single short reads are flagged uncertain.
 */
export async function florenceOcr(canvas: HTMLCanvasElement, opts: { tiles?: boolean; region?: Box; onProgress?: (m: string) => void } = {}): Promise<OcrLine[]> {
  await loadFlorence(opts.onProgress);
  const passes: { box: Box }[] = [{ box: { x: 0, y: 0, w: 1, h: 1 } }];
  if (opts.tiles) for (const [x, y] of [[0, 0], [0.45, 0], [0, 0.45], [0.45, 0.45]]) passes.push({ box: { x, y, w: 0.55, h: 0.55 } });
  const seen = new Map<string, { text: string; box: Box; hits: number; tileHit: boolean }>();
  let i = 0;
  for (const p of passes) {
    opts.onProgress?.(passes.length > 1 ? `Reading scene text (pass ${++i}/${passes.length})` : "Reading scene text");
    let c = canvas;
    if (p.box.w < 1) {
      c = document.createElement("canvas");
      c.width = Math.round(canvas.width * p.box.w);
      c.height = Math.round(canvas.height * p.box.h);
      c.getContext("2d")!.drawImage(canvas, canvas.width * p.box.x, canvas.height * p.box.y, c.width, c.height, 0, 0, c.width, c.height);
    }
    for (const l of await ocrCanvas(c)) {
      let box: Box = { x: p.box.x + l.box.x * p.box.w, y: p.box.y + l.box.y * p.box.h, w: l.box.w * p.box.w, h: l.box.h * p.box.h };
      if (opts.region) box = { x: opts.region.x + box.x * opts.region.w, y: opts.region.y + box.y * opts.region.h, w: box.w * opts.region.w, h: box.h * opts.region.h };
      const key = l.text.toLowerCase().replace(/\s+/g, "");
      const cur = seen.get(key);
      if (cur) cur.hits++;
      else seen.set(key, { text: l.text, box, hits: 1, tileHit: p.box.w < 1 });
      if (cur && p.box.w < 1) cur.tileHit = true;
    }
  }
  // partial reads from tiles ("BROAD", "OADWAY") are fragments of a fuller read ("BROADWAY"): fold them in
  const all = [...seen.entries()];
  for (const [k, v] of all) {
    const parent = all.find(([k2]) => k2 !== k && k2.length > k.length && k2.includes(k));
    if (parent) {
      parent[1].hits += v.hits;
      seen.delete(k);
    }
  }
  return [...seen.values()].map((s) => {
    const letters = s.text.replace(/[^\p{L}]/gu, "").length;
    // with tiles enabled, real text is normally re-read in a zoomed tile; full-frame-only reads are suspect
    const conf = opts.tiles && !s.tileHit && s.hits === 1 ? 45 : Math.min(95, 62 + (s.hits - 1) * 15 + Math.min(18, letters * 2));
    return { id: uid("ocr"), text: s.text, confidence: conf, box: s.box, source: opts.region ? "region" : "original", engine: "florence-2", uncertain: conf < 70 || letters < 3 } as OcrLine;
  });
}

/** A detailed natural-language description of the whole image (Florence-2). */
export async function florenceCaption(canvas: HTMLCanvasElement, onProgress?: (m: string) => void): Promise<string> {
  const { model, processor } = await loadFlorence(onProgress);
  const T = await transformers();
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.92));
  const image = await T.RawImage.fromBlob(blob);
  const task = "<MORE_DETAILED_CAPTION>";
  const inputs = await processor(image, processor.construct_prompts(task));
  const ids = await model.generate({ ...inputs, max_new_tokens: 120 });
  const text = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  return String(processor.post_process_generation(text, task, image.size)[task] || "").trim();
}
