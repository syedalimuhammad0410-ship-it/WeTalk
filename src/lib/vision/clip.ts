"use client";
// In-browser CLIP (transformers.js, ONNX/WASM) for zero-shot scene understanding and
// image embeddings used in visual matching. Models are fetched from the Hugging Face hub
// once and cached by the browser.

import type { SceneLabel } from "@/lib/types";

const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";
const CLIP = "Xenova/clip-vit-base-patch32";
const DETR = "Xenova/detr-resnet-50";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TJS = any;
let tjsP: Promise<TJS> | null = null;
export function transformers(): Promise<TJS> {
  if (!tjsP) {
    tjsP = import(/* webpackIgnore: true */ /* @vite-ignore */ CDN as string).then((T: TJS) => {
      T.env.allowLocalModels = false;
      // Hugging Face rejects model downloads whose Referer is a *.workers.dev page (404 without CORS),
      // so model files are fetched without a referrer — this works the same on every host.
      T.env.fetch = (input: string | URL, init?: RequestInit) => fetch(input, { ...init, referrerPolicy: "no-referrer" });
      return T;
    });
    tjsP.catch(() => (tjsP = null));
  }
  return tjsP;
}

export interface SceneDef {
  label: string;
  prompt: string;
  group: string;
  hints: string[];
}

export const SCENES: SceneDef[] = [
  { label: "basketball court", prompt: "a photo of an indoor basketball court with a painted wooden floor", group: "sports venue", hints: ["basketball", "arena"] },
  { label: "basketball arena (crowd view)", prompt: "a photo of a professional basketball game in a large arena full of spectators", group: "sports venue", hints: ["basketball", "arena"] },
  { label: "soccer / football stadium", prompt: "a photo of a soccer stadium with a grass pitch", group: "sports venue", hints: ["soccer", "stadium"] },
  { label: "American football stadium", prompt: "a photo of an American football stadium", group: "sports venue", hints: ["football", "stadium"] },
  { label: "baseball field", prompt: "a photo of a baseball field in a ballpark", group: "sports venue", hints: ["baseball", "stadium"] },
  { label: "ice hockey rink", prompt: "a photo of an ice hockey rink in an arena", group: "sports venue", hints: ["hockey", "arena"] },
  { label: "tennis court", prompt: "a photo of a tennis court", group: "sports venue", hints: ["tennis"] },
  { label: "arena / stadium exterior", prompt: "a photo of the outside of a sports arena building", group: "sports venue", hints: ["arena"] },
  { label: "street sign", prompt: "a close-up photo of a street name sign", group: "street", hints: ["street"] },
  { label: "city street", prompt: "a photo of a city street with buildings and cars", group: "street", hints: ["street"] },
  { label: "road / highway", prompt: "a photo of a highway road", group: "street", hints: ["street"] },
  { label: "storefront", prompt: "a photo of a shop storefront with a sign", group: "business", hints: ["storefront"] },
  { label: "restaurant exterior", prompt: "a photo of a restaurant or diner exterior with its sign", group: "business", hints: ["restaurant"] },
  { label: "restaurant interior", prompt: "a photo inside a restaurant dining room", group: "business", hints: ["restaurant"] },
  { label: "hotel exterior / sign", prompt: "a photo of a hotel building or hotel sign", group: "business", hints: ["hotel"] },
  { label: "hotel lobby", prompt: "a photo of a hotel lobby", group: "business", hints: ["hotel"] },
  { label: "neon sign", prompt: "a photo of a glowing neon sign at night", group: "business", hints: ["storefront"] },
  { label: "university building", prompt: "a photo of a university campus building", group: "building", hints: ["university"] },
  { label: "apartment building", prompt: "a photo of an apartment building", group: "building", hints: [] },
  { label: "office tower", prompt: "a photo of a modern office skyscraper", group: "building", hints: [] },
  { label: "church / cathedral", prompt: "a photo of a church or cathedral", group: "building", hints: [] },
  { label: "landmark / monument", prompt: "a photo of a famous landmark or monument", group: "landmark", hints: [] },
  { label: "bridge", prompt: "a photo of a bridge", group: "landmark", hints: [] },
  { label: "transit station", prompt: "a photo of a train or subway station", group: "transit", hints: [] },
  { label: "airport", prompt: "a photo of an airport terminal", group: "transit", hints: [] },
  { label: "park", prompt: "a photo of a public park with trees and paths", group: "outdoor", hints: [] },
  { label: "shopping mall", prompt: "a photo inside a shopping mall", group: "building", hints: [] },
  { label: "newspaper page", prompt: "a scan of a printed newspaper front page", group: "document", hints: ["newspaper", "document"] },
  { label: "document / letter", prompt: "a photo of a printed document or letter", group: "document", hints: ["document"] },
  { label: "screenshot", prompt: "a screenshot of a website or phone app", group: "document", hints: ["document"] },
  { label: "map", prompt: "a printed or digital map", group: "document", hints: [] },
  { label: "vehicle", prompt: "a photo of a car or bus on a road", group: "object", hints: [] },
  { label: "coastline / beach", prompt: "a photo of a beach and coastline", group: "outdoor", hints: [] },
  { label: "mountain landscape", prompt: "a photo of a mountain landscape", group: "outdoor", hints: [] },
  { label: "historical photograph", prompt: "an old black and white historical photograph", group: "historical", hints: ["historical"] },
];

export const STYLES = [
  "Art Deco",
  "Brutalist concrete",
  "Victorian",
  "Gothic",
  "modern glass and steel",
  "colonial",
  "Mediterranean stucco",
  "industrial warehouse",
  "traditional East Asian",
  "Islamic",
  "Soviet-era block",
  "mid-century modern",
  "neoclassical with columns",
];

export const ENVIRONMENT = [
  "daytime outdoors",
  "night time",
  "indoors under artificial light",
  "snowy winter",
  "tropical with palm trees",
  "desert",
  "rainy weather",
  "dense urban downtown",
  "suburban",
  "rural countryside",
];

interface ClipModels {
  processor: TJS;
  tokenizer: TJS;
  vision: TJS;
  text: TJS;
}
let modelsP: Promise<ClipModels> | null = null;
const textCache = new Map<string, Float32Array>();

export function loadClip(): Promise<ClipModels> {
  if (!modelsP) {
    modelsP = (async () => {
      const T = await transformers();
      // Use the GPU (WebGPU) when available; fall back to WASM on the CPU.
      const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
      const gpu = Boolean(nav.gpu && (await nav.gpu.requestAdapter().catch(() => null)));
      const load = (device: string) =>
        Promise.all([
          T.AutoProcessor.from_pretrained(CLIP),
          T.AutoTokenizer.from_pretrained(CLIP),
          T.CLIPVisionModelWithProjection.from_pretrained(CLIP, device === "webgpu" ? { device, dtype: "fp16" } : { dtype: "q8" }),
          T.CLIPTextModelWithProjection.from_pretrained(CLIP, device === "webgpu" ? { device, dtype: "fp16" } : { dtype: "q8" }),
        ]);
      const [processor, tokenizer, vision, text] = gpu ? await load("webgpu").catch(() => load("wasm")) : await load("wasm");
      return { processor, tokenizer, vision, text };
    })();
    modelsP.catch(() => (modelsP = null));
  }
  return modelsP;
}

function normalize(v: Float32Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n) as Float32Array;
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function canvasToRaw(c: HTMLCanvasElement) {
  const T = await transformers();
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.92));
  return T.RawImage.fromBlob(blob);
}

export async function imageEmbedding(c: HTMLCanvasElement): Promise<Float32Array> {
  const m = await loadClip();
  const raw = await canvasToRaw(c);
  const inputs = await m.processor(raw);
  const { image_embeds } = await m.vision(inputs);
  return normalize(new Float32Array(image_embeds.data));
}

async function textEmbeddings(prompts: string[]): Promise<Float32Array[]> {
  const m = await loadClip();
  const missing = prompts.filter((p) => !textCache.has(p));
  if (missing.length) {
    const inputs = m.tokenizer(missing, { padding: true, truncation: true });
    const { text_embeds } = await m.text(inputs);
    const dim = text_embeds.dims[1];
    missing.forEach((p, i) => textCache.set(p, normalize(new Float32Array(text_embeds.data.slice(i * dim, (i + 1) * dim)))));
  }
  return prompts.map((p) => textCache.get(p)!);
}

function softmax(xs: number[], scale = 100) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp((x - m) * scale));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export async function zeroShot(emb: Float32Array, prompts: string[]): Promise<number[]> {
  const T = await textEmbeddings(prompts);
  return softmax(T.map((t) => cosine(emb, t)));
}

export async function classifyScene(emb: Float32Array): Promise<{ scenes: SceneLabel[]; hints: string[]; styles: SceneLabel[]; environment: SceneLabel[] }> {
  const probs = await zeroShot(emb, SCENES.map((s) => s.prompt));
  const scenes = SCENES.map((s, i) => ({ label: s.label, score: probs[i], group: s.group })).sort((a, b) => b.score - a.score);
  const top = scenes.slice(0, 3).filter((s, i) => i === 0 || s.score > 0.12);
  const hints = Array.from(new Set(top.flatMap((t) => SCENES.find((s) => s.label === t.label)!.hints)));
  const styleProbs = await zeroShot(emb, STYLES.map((s) => `a photo of a building in ${s} architectural style`));
  const styles = STYLES.map((s, i) => ({ label: s, score: styleProbs[i], group: "architecture" })).sort((a, b) => b.score - a.score);
  const envProbs = await zeroShot(emb, ENVIRONMENT.map((s) => `a photo taken ${s}`));
  const environment = ENVIRONMENT.map((s, i) => ({ label: s, score: envProbs[i], group: "environment" })).sort((a, b) => b.score - a.score);
  return { scenes: scenes.slice(0, 8), hints, styles: styles.slice(0, 3), environment: environment.slice(0, 3) };
}

// ---------------- object detection ----------------
let detP: Promise<TJS> | null = null;
export async function detectObjects(c: HTMLCanvasElement): Promise<{ label: string; score: number; box: { x: number; y: number; w: number; h: number } }[]> {
  if (!detP) {
    detP = transformers().then(async (T) => {
      const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
      const gpu = Boolean(nav.gpu && (await nav.gpu.requestAdapter().catch(() => null)));
      return gpu ? T.pipeline("object-detection", DETR, { device: "webgpu", dtype: "fp16" }).catch(() => T.pipeline("object-detection", DETR, { dtype: "q8" })) : T.pipeline("object-detection", DETR, { dtype: "q8" });
    });
    detP.catch(() => (detP = null));
  }
  const det = await detP;
  const raw = await canvasToRaw(c);
  const out: { label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }[] = await det(raw, { threshold: 0.8, percentage: true });
  return out.map((o) => ({ label: o.label, score: o.score, box: { x: o.box.xmin, y: o.box.ymin, w: o.box.xmax - o.box.xmin, h: o.box.ymax - o.box.ymin } }));
}

/**
 * Zero-shot logo/team recognition: compares the image (and crops) against
 * "the logo of <team>" prompts for a candidate list supplied by Wikidata.
 * Returns probabilities — treated as probabilistic visual evidence, never proof.
 */
export async function recognizeLogos(c: HTMLCanvasElement, names: string[], sport: string): Promise<{ name: string; p: number; crop: string }[]> {
  if (!names.length) return [];
  const prompts = [...names.map((n) => `the ${n} logo`), `a photo of a crowd`, `a photo of a ${sport} player`, `an empty wooden floor`];
  // full frame + 3×3 overlapping windows so small logos (e.g. centre-court art) are seen at usable resolution
  const crops: { name: string; box?: { x: number; y: number; w: number; h: number } }[] = [{ name: "full" }];
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) crops.push({ name: `tile ${gx + 1},${gy + 1}`, box: { x: gx * 0.275, y: gy * 0.275, w: 0.45, h: 0.45 } });
  const best = new Map<string, { p: number; crop: string }>();
  for (const cr of crops) {
    let cv = c;
    if (cr.box) {
      cv = document.createElement("canvas");
      cv.width = Math.round(c.width * cr.box.w);
      cv.height = Math.round(c.height * cr.box.h);
      cv.getContext("2d")!.drawImage(c, c.width * cr.box.x, c.height * cr.box.y, cv.width, cv.height, 0, 0, cv.width, cv.height);
    }
    const emb = await imageEmbedding(cv);
    const probs = await zeroShot(emb, prompts);
    names.forEach((n, i) => {
      const cur = best.get(n);
      if (!cur || probs[i] > cur.p) best.set(n, { p: probs[i], crop: cr.name });
    });
  }
  return [...best.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.p - a.p);
}
