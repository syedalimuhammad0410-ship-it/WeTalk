"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, ScanText } from "lucide-react";
import { Button, Dialog, Label, Toggle, cn } from "@/components/ui";
import { api, imageUrl } from "@/lib/client/api";
import { getState, ws } from "@/lib/client/store";
import type { Box, ImageRecord } from "@/lib/types";
import { compact } from "@/lib/util";

type Ops = {
  sharpen: boolean;
  deblur: boolean;
  denoise: boolean;
  contrast: number;
  brightness: number;
  normalize: boolean;
  upscale: number;
  ocrMode: boolean;
  rotate: number;
};
const DEFAULT: Ops = { sharpen: true, deblur: false, denoise: false, contrast: 1.2, brightness: 1, normalize: true, upscale: 1, ocrMode: false, rotate: 0 };

export function EnhanceDialog({ open, onClose, image, crop }: { open: boolean; onClose: () => void; image: ImageRecord; crop?: Box }) {
  const [ops, setOps] = useState<Ops>(DEFAULT);
  const [result, setResult] = useState<{ url: string; blob: Blob; ops: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocr, setOcr] = useState<{ original: string[]; enhanced: { text: string; conf: number }[] } | null>(null);
  const [persp, setPersp] = useState(false);
  const [quad, setQuad] = useState([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ]);
  const quadRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setOcr(null);
      setError(null);
      setOps(DEFAULT);
      setPersp(false);
    }
  }, [open, image.id]);

  function opList() {
    const list: Record<string, unknown>[] = [];
    if (crop) list.push({ op: "crop", ...crop });
    if (ops.rotate) list.push({ op: "rotate", degrees: ops.rotate });
    if (ops.upscale > 1) list.push({ op: "upscale", factor: ops.upscale });
    if (ops.denoise) list.push({ op: "denoise", size: 3 });
    if (ops.normalize) list.push({ op: "normalize" });
    if (ops.contrast !== 1) list.push({ op: "contrast", amount: ops.contrast });
    if (ops.brightness !== 1) list.push({ op: "brightness", amount: ops.brightness });
    if (ops.deblur) list.push({ op: "deblur", sigma: 1.5 });
    if (ops.sharpen) list.push({ op: "sharpen", amount: 1.2 });
    if (ops.ocrMode) list.push({ op: "grayscale" });
    return list;
  }

  async function run() {
    setBusy("Enhancing on server…");
    setError(null);
    setOcr(null);
    try {
      let blob: Blob;
      let applied: string[];
      if (persp) {
        const { loadImage, toCanvas, perspectiveWarp, canvasToBlob } = await import("@/lib/vision/image");
        const c = toCanvas(await loadImage(imageUrl(image.key)), 2400);
        blob = await canvasToBlob(perspectiveWarp(c, quad));
        applied = ["perspective"];
      } else {
        const list = opList();
        if (!list.length) throw new Error("Choose at least one enhancement.");
        const res = await fetch("/api/enhance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageKey: image.key, ops: list }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Enhancement failed (${res.status})`);
        blob = await res.blob();
        applied = list.map((o) => String(o.op));
      }
      setResult({ url: URL.createObjectURL(blob), blob, ops: applied });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function compareOcr() {
    if (!result) return;
    setBusy("Running OCR on original and enhanced…");
    try {
      const { loadImage, toCanvas } = await import("@/lib/vision/image");
      const { runOcr } = await import("@/lib/vision/ocr");
      const orig = toCanvas(await loadImage(imageUrl(image.key)), 2000, persp ? undefined : crop);
      const enh = toCanvas(await loadImage(result.url), 2400);
      const [a, b] = await Promise.all([runOcr(orig, { source: "original", passes: 1 }), runOcr(enh, { source: "enhanced", passes: 1 })]);
      setOcr({ original: a.map((l) => l.text), enhanced: b.map((l) => ({ text: l.text, conf: l.confidence })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function useEnhanced() {
    if (!result) return;
    setBusy("Saving enhanced image…");
    try {
      const { loadImage } = await import("@/lib/vision/image");
      const el = await loadImage(result.url);
      const { image: rec } = await api.upload(getState().inv!.id, result.blob, { name: `${image.name.replace(/\.[a-z]+$/i, "")} (enhanced).jpg`, width: el.naturalWidth, height: el.naturalHeight, enhancedFrom: image.id, enhancements: result.ops });
      ws.update((i) => ({ ...i, images: [...i.images, rec] }));
      await ws.saveNow();
      onClose();
      ws.log(`Enhanced image added (${result.ops.join(", ")}). Its text is labelled “enhanced”, separate from the original.`);
      void ws.start({ focus: { imageId: rec.id, instruction: "Analyse the enhanced image" } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const origWords = new Set((ocr?.original || []).map(compact));
  return (
    <Dialog open={open} onClose={onClose} title="Enhance image" wide>
      <div className="mb-4 flex items-start gap-2 rounded-[5px] border border-warn/30 bg-warn/5 p-3 text-[12px] leading-relaxed text-warn">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        Enhancement redistributes detail that is already in the pixels. It cannot recover information that was never captured. Text read only after enhancement is labelled as uncertain.
      </div>
      <div className="grid gap-5 md:grid-cols-[230px_1fr]">
        <div className="space-y-3">
          <Toggle label="Perspective correction (4-point)" checked={persp} onChange={setPersp} />
          <div className={cn("space-y-3", persp && "pointer-events-none opacity-40")}>
            <Toggle label="Sharpen" checked={ops.sharpen} onChange={(v) => setOps({ ...ops, sharpen: v })} />
            <Toggle label="Deblur (unsharp mask)" checked={ops.deblur} onChange={(v) => setOps({ ...ops, deblur: v })} />
            <Toggle label="Denoise (median)" checked={ops.denoise} onChange={(v) => setOps({ ...ops, denoise: v })} />
            <Toggle label="Auto levels" checked={ops.normalize} onChange={(v) => setOps({ ...ops, normalize: v })} />
            <Toggle label="OCR mode (grayscale)" checked={ops.ocrMode} onChange={(v) => setOps({ ...ops, ocrMode: v })} />
            <Slider label="Contrast" min={0.6} max={2} step={0.05} value={ops.contrast} onChange={(v) => setOps({ ...ops, contrast: v })} />
            <Slider label="Brightness" min={0.5} max={1.8} step={0.05} value={ops.brightness} onChange={(v) => setOps({ ...ops, brightness: v })} />
            <Slider label="Upscale (Lanczos)" min={1} max={3} step={0.5} value={ops.upscale} onChange={(v) => setOps({ ...ops, upscale: v })} suffix="×" />
            <Slider label="Rotate" min={-45} max={45} step={1} value={ops.rotate} onChange={(v) => setOps({ ...ops, rotate: v })} suffix="°" />
            {crop && <div className="text-[11.5px] text-cyan">Cropping to the selected region</div>}
          </div>
          <Button variant="primary" className="w-full" onClick={run} loading={busy?.startsWith("Enhancing")}>
            Enhance
          </Button>
        </div>
        <div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1">Original</Label>
              <div ref={quadRef} className="relative overflow-hidden rounded-[4px] border border-line bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(image.key)} alt="Original" className="w-full select-none" draggable={false} />
                {crop && !persp && <div className="absolute border-2 border-dashed border-warn" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />}
                {persp && (
                  <svg
                    className="absolute inset-0 h-full w-full touch-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    onPointerMove={(e) => {
                      if (dragIdx.current === null) return;
                      const r = quadRef.current!.getBoundingClientRect();
                      const p = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
                      setQuad((q) => q.map((pt, i) => (i === dragIdx.current ? p : pt)));
                    }}
                    onPointerUp={() => (dragIdx.current = null)}
                  >
                    <polygon points={quad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(89,212,232,0.12)" stroke="#59d4e8" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                    {quad.map((p, i) => (
                      <circle key={i} cx={p.x * 100} cy={p.y * 100} r={2.4} fill="#ff7a45" className="cursor-move" onPointerDown={(e) => ((e.target as Element).setPointerCapture(e.pointerId), (dragIdx.current = i))} />
                    ))}
                  </svg>
                )}
              </div>
              {persp && <p className="mt-1 text-[11px] text-mute">Drag the corners onto the sign or document edges (TL, TR, BR, BL).</p>}
            </div>
            <div>
              <Label className="mb-1">Enhanced</Label>
              <div className="grid min-h-[140px] place-items-center overflow-hidden rounded-[4px] border border-line bg-black">
                {busy?.startsWith("Enhancing") ? <Loader2 className="size-5 animate-spin text-cyan" /> : result ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.url} alt="Enhanced" className="w-full" />
                ) : (
                  <span className="p-4 text-center text-[12px] text-mute">Choose options and press Enhance</span>
                )}
              </div>
              {result && <div className="mt-1 font-mono text-[10.5px] text-mute">applied: {result.ops.join(" → ")}</div>}
            </div>
          </div>
          {error && <div className="mt-3 rounded border border-alert/30 bg-alert/10 px-3 py-2 text-[12.5px] text-alert">{error}</div>}
          {result && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={compareOcr} loading={busy?.startsWith("Running OCR")}>
                <ScanText className="size-4" /> Compare OCR: original vs enhanced
              </Button>
              <Button variant="primary" onClick={useEnhanced} loading={busy?.startsWith("Saving")}>
                <Check className="size-4" /> Use Enhanced Image for Analysis
              </Button>
            </div>
          )}
          {ocr && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <Label className="mb-1">Text in original</Label>
                {ocr.original.length ? ocr.original.map((t, i) => <div key={i} className="font-mono">{t}</div>) : <div className="text-mute">none</div>}
              </div>
              <div>
                <Label className="mb-1">Text in enhanced</Label>
                {ocr.enhanced.length ? (
                  ocr.enhanced.map((t, i) => {
                    const fromOriginal = origWords.has(compact(t.text));
                    return (
                      <div key={i} className={cn("font-mono", fromOriginal ? "" : "text-warn")}>
                        {t.text} <span className="text-mute">{fromOriginal ? "· also in original" : `· enhanced-only, uncertain (${t.conf}%)`}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-mute">none</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Slider({ label, min, max, step, value, onChange, suffix = "" }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="block text-[12.5px] text-dim">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-fg">
          {value}
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[#59d4e8]" />
    </label>
  );
}
