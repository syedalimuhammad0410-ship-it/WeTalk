"use client";
import { useEffect, useRef, useState } from "react";
import { GitCompareArrows, Loader2, Sparkles } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { api, imageUrl, proxied } from "@/lib/client/api";
import { Button, Empty, Label, cn } from "@/components/ui";
import type { VisualComparison } from "@/lib/types";

type Mode = "side" | "overlay" | "difference";

export function CompareView() {
  const inv = useWorkspace((s) => s.inv)!;
  const sel = useWorkspace((s) => s.selectedCandidateId);
  const providers = useWorkspace((s) => s.providers);
  const withImgs = inv.candidates.filter((c) => c.images.length);
  const [candId, setCandId] = useState(sel && withImgs.some((c) => c.id === sel) ? sel : withImgs[0]?.id);
  const cand = inv.candidates.find((c) => c.id === candId);
  const [refId, setRefId] = useState<string | undefined>(cand?.images[0]?.id);
  const [imgId, setImgId] = useState(inv.images[0]?.id);
  const [mode, setMode] = useState<Mode>("side");
  const [opacity, setOpacity] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showCells, setShowCells] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [ai, setAi] = useState<{ matches: { feature: string; strength: string }[]; differences: string[]; verdict: string; note: string } | null>(null);
  const diffRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (cand && !cand.images.some((i) => i.id === refId)) setRefId(cand.images[0]?.id);
  }, [cand, refId]);
  const ref = cand?.images.find((i) => i.id === refId);
  const base = inv.images.find((i) => i.id === imgId);

  useEffect(() => {
    if (mode !== "difference" || !ref || !base) return;
    let alive = true;
    (async () => {
      const { loadImage } = await import("@/lib/vision/image");
      const [a, b] = await Promise.all([loadImage(imageUrl(base.key)), loadImage(proxied(ref.thumb))]);
      if (!alive || !diffRef.current) return;
      const W = 640;
      const H = Math.round((W * a.naturalHeight) / a.naturalWidth);
      const c = diffRef.current;
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(a, 0, 0, W, H);
      const da = ctx.getImageData(0, 0, W, H);
      ctx.drawImage(b, 0, 0, W, H);
      const db = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < da.data.length; i += 4) {
        const d = (Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2])) / 3;
        da.data[i] = Math.min(255, d * 2.2);
        da.data[i + 1] = Math.max(0, 140 - d);
        da.data[i + 2] = Math.max(0, 160 - d);
      }
      ctx.putImageData(da, 0, 0);
    })();
    return () => {
      alive = false;
    };
  }, [mode, ref, base]);

  if (!withImgs.length) return <Empty icon={<GitCompareArrows className="size-7" />} title="Nothing to compare yet">Reference photos are retrieved for candidates during the matching phase.</Empty>;

  async function compareNow() {
    if (!ref || !base || !cand) return;
    setBusy("Comparing…");
    try {
      const { loadImage, toCanvas } = await import("@/lib/vision/image");
      const clip = await import("@/lib/vision/clip");
      const { compareCanvases } = await import("@/lib/vision/compare");
      const a = toCanvas(await loadImage(imageUrl(base.key)), 640);
      const b = toCanvas(await loadImage(proxied(ref.thumb)), 640);
      const [ea, eb] = await Promise.all([clip.imageEmbedding(a), clip.imageEmbedding(b)]);
      const cmp: VisualComparison = compareCanvases(a, b, ea, eb);
      ws.update((i) => ({ ...i, candidates: i.candidates.map((c) => (c.id === cand.id ? { ...c, images: c.images.map((x) => (x.id === ref.id ? { ...x, comparison: cmp } : x)) } : c)) }));
      ws.reassess();
    } catch (e) {
      ws.log(`Comparison failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(null);
    }
  }
  async function aiCompare() {
    if (!ref || !base || !cand) return;
    setBusy("AI feature comparison…");
    try {
      const r = await api.post<{ status: string; error?: string; matches: { feature: string; strength: string }[]; differences: string[]; verdict: string; note: string }>("/api/compare", { imageKey: base.key, referenceUrl: ref.thumb, context: cand.name });
      if (r.status !== "ok") throw new Error(r.error || r.status);
      setAi(r);
    } catch (e) {
      ws.log(`AI comparison: ${e instanceof Error ? e.message : e}`, "warn");
    } finally {
      setBusy(null);
    }
  }

  const transform = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` };
  const panHandlers = {
    onPointerDown: (e: React.PointerEvent) => ((e.target as HTMLElement).setPointerCapture(e.pointerId), (drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y })),
    onPointerMove: (e: React.PointerEvent) => drag.current && setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }),
    onPointerUp: () => (drag.current = null),
    onWheel: (e: React.WheelEvent) => setZoom((z) => Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 0.9)))),
  };
  const cells = showCells ? ref?.comparison?.cells?.filter((c) => c.score >= 0.7) : undefined;
  const Cells = () => (
    <>
      {cells?.map((c, i) => (
        <div key={i} className="pointer-events-none absolute border border-ok/70 bg-ok/10" style={{ left: `${c.box.x * 100}%`, top: `${c.box.y * 100}%`, width: `${c.box.w * 100}%`, height: `${c.box.h * 100}%` }} />
      ))}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <select aria-label="Image" value={imgId} onChange={(e) => setImgId(e.target.value)} className="h-8 max-w-[180px] rounded-[5px] border border-line-strong bg-black/30 px-2 text-[12px]">
          {inv.images.map((im, i) => (
            <option key={im.id} value={im.id}>
              IMG {i + 1} · {im.name.slice(0, 24)}
            </option>
          ))}
        </select>
        <span className="text-mute">vs</span>
        <select aria-label="Candidate" value={candId} onChange={(e) => setCandId(e.target.value)} className="h-8 max-w-[220px] rounded-[5px] border border-line-strong bg-black/30 px-2 text-[12px]">
          {withImgs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex rounded-[5px] border border-line-strong">
          {(["side", "overlay", "difference"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("px-2.5 py-1 text-[12px] capitalize", mode === m ? "bg-white/10 text-fg" : "text-mute")}>
              {m === "side" ? "Side by side" : m}
            </button>
          ))}
        </div>
        {mode === "overlay" && (
          <label className="flex items-center gap-2 text-[12px] text-dim">
            Transparency
            <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="accent-[#59d4e8]" />
          </label>
        )}
        <label className="flex items-center gap-1.5 text-[12px] text-dim">
          <input type="checkbox" checked={showCells} onChange={(e) => setShowCells(e.target.checked)} /> Matching areas
        </label>
        <div className="flex-1" />
        <Button size="sm" onClick={compareNow} loading={busy === "Comparing…"}>
          <GitCompareArrows className="size-3.5" /> {ref?.comparison ? "Re-compare" : "Compare"}
        </Button>
        <Button size="sm" variant="ghost" onClick={aiCompare} disabled={!providers?.ai} title={providers?.ai ? "AI feature-level comparison" : "Requires ANTHROPIC_API_KEY"} loading={busy?.startsWith("AI")}>
          <Sparkles className="size-3.5" /> AI features
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_300px]">
        <div className="relative min-h-[320px] overflow-hidden bg-[#050607]" {...panHandlers}>
          {busy && (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded bg-black/80 px-2 py-1 text-[12px] text-cyan">
              <Loader2 className="size-3.5 animate-spin" />
              {busy}
            </div>
          )}
          {base && ref && mode === "side" && (
            <div className="grid h-full grid-cols-2 gap-1 p-2">
              {[{ src: imageUrl(base.key), label: "ORIGINAL" }, { src: proxied(ref.thumb), label: "CANDIDATE" }].map((p, i) => (
                <div key={i} className="relative overflow-hidden rounded-[3px] border border-line">
                  <div className="absolute inset-0 grid place-items-center" style={transform}>
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.src} alt={p.label} draggable={false} className="max-h-[60vh] max-w-full select-none" />
                      {i === 0 && <Cells />}
                      {i === 1 && <Cells />}
                    </div>
                  </div>
                  <span className="label-mono absolute left-2 top-2 bg-black/80 px-1.5 !text-[9px] text-cyan">{p.label}</span>
                </div>
              ))}
            </div>
          )}
          {base && ref && mode === "overlay" && (
            <div className="absolute inset-0 grid place-items-center p-3" style={transform}>
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(base.key)} alt="Original" draggable={false} className="max-h-[70vh] max-w-full select-none" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proxied(ref.thumb)} alt="Candidate overlay" draggable={false} className="absolute inset-0 h-full w-full select-none object-cover" style={{ opacity }} />
                <Cells />
              </div>
            </div>
          )}
          {base && ref && mode === "difference" && (
            <div className="absolute inset-0 grid place-items-center p-3" style={transform}>
              <canvas ref={diffRef} className="max-h-[70vh] max-w-full" />
              <span className="label-mono absolute bottom-3 left-3 bg-black/80 px-1.5 !text-[9px] text-dim">Difference view: bright = different, dark teal = similar (alignment is not corrected)</span>
            </div>
          )}
        </div>
        <div className="overflow-y-auto border-l border-line bg-panel p-3">
          <Label className="mb-2">Reference photos</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {cand?.images.map((im) => (
              <button key={im.id} onClick={() => setRefId(im.id)} className={cn("relative overflow-hidden rounded-[3px] border", im.id === refId ? "border-cyan" : "border-line")} title={im.title}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proxied(im.thumb)} alt={im.title} className="aspect-square w-full object-cover" loading="lazy" />
                {im.comparison && <span className="label-mono absolute bottom-0 left-0 bg-black/80 px-0.5 !text-[7.5px] text-cyan">{im.comparison.overall}</span>}
              </button>
            ))}
          </div>
          {ref && (
            <div className="mt-3 text-[12px]">
              <a href={ref.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                {ref.title}
              </a>
              <div className="text-mute">{ref.license || "License on source page"}</div>
            </div>
          )}
          {ref?.comparison ? (
            <div className="mt-4 space-y-1.5 text-[12px]">
              <Label>Measured similarity</Label>
              <div className="flex justify-between">
                <span className="text-dim">Overall</span>
                <span className="font-semibold uppercase">{ref.comparison.overall === "none" ? "no resemblance" : ref.comparison.overall}</span>
              </div>
              {ref.comparison.embedding !== undefined && (
                <div className="flex justify-between">
                  <span className="text-dim">Scene content (CLIP)</span>
                  <span>{ref.comparison.embedding >= 0.79 ? "closely aligned" : ref.comparison.embedding >= 0.71 ? "related" : "different"}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-dim">Colour palette</span>
                <span>{(ref.comparison.color || 0) >= 0.6 ? "similar" : (ref.comparison.color || 0) >= 0.4 ? "partly similar" : "different"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Line geometry</span>
                <span>{(ref.comparison.structure || 0) >= 0.85 ? "similar" : (ref.comparison.structure || 0) >= 0.7 ? "partly similar" : "different"}</span>
              </div>
              <ul className="mt-2 space-y-0.5 text-mute">
                {ref.comparison.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
              <p className="pt-2 text-[11px] leading-relaxed text-mute">Visual similarity is indirect evidence. Different angles, years or framing lower similarity, and similar-looking places raise it. It is not proof of identity.</p>
            </div>
          ) : (
            <p className="mt-4 text-[12px] text-mute">This reference has not been compared yet.</p>
          )}
          {ai && (
            <div className="mt-4 rounded-[4px] border border-cyan/30 bg-cyan/5 p-2.5 text-[12px]">
              <Label className="mb-1">AI feature comparison · {ai.verdict}</Label>
              {ai.matches.map((m, i) => (
                <div key={i}>
                  MATCH #{i + 1}: {m.feature} <span className="text-mute">({m.strength})</span>
                </div>
              ))}
              {ai.differences.map((d, i) => (
                <div key={`d${i}`} className="text-warn">
                  Difference: {d}
                </div>
              ))}
              <div className="mt-1 text-mute">{ai.note}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
