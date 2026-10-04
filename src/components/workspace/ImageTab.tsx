"use client";
import { useRef, useState } from "react";
import { Crop, Eye, EyeOff, ImagePlus, Link2, Loader2, Minus, Plus, RotateCw, ScanSearch, ScanText, Search, Sparkles, SquareDashedMousePointer, Wand2 } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Button, Label, Panel, cn } from "@/components/ui";
import { api, imageUrl } from "@/lib/client/api";
import type { Box, Clue, ImageRecord } from "@/lib/types";
import { nowIso, uid } from "@/lib/util";
import { EnhanceDialog } from "./EnhanceDialog";
import { ReverseSearch } from "./ReverseSearch";

export function ImageTab() {
  const inv = useWorkspace((s) => s.inv)!;
  const running = useWorkspace((s) => s.running);
  const [activeId, setActiveId] = useState(inv.images[0]?.id);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState<Box | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [enhance, setEnhance] = useState<{ open: boolean; crop?: Box }>({ open: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<{ a: string; b: string; reasons: string[] }[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; mode: "pan" | "select" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const img = inv.images.find((i) => i.id === activeId) || inv.images[0];
  if (!img) return <div className="p-6 text-[13px] text-mute">No images in this investigation.</div>;
  const aspect = img.width && img.height ? img.width / img.height : 4 / 3;
  const clues = inv.clues.filter((c) => c.imageId === img.id);
  const regions = inv.regions.filter((r) => r.imageId === img.id);

  const rel = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = rel(e);
    drag.current = { x: p.x, y: p.y, px: e.clientX - pan.x, py: e.clientY - pan.y, mode: selecting && rot === 0 ? "select" : "pan" };
    if (drag.current.mode === "select") setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") setPan({ x: e.clientX - d.px, y: e.clientY - d.py });
    else {
      const p = rel(e);
      setDraft({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) });
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === "select" && draft && draft.w > 0.02 && draft.h > 0.02) {
      const label = window.prompt("Label this region (e.g. sign, logo, building)", "region") || "region";
      ws.update((i) => ({ ...i, regions: [...i.regions, { id: uid("reg"), imageId: img.id, box: draft, label: label.slice(0, 60), createdAt: nowIso() }] }));
      setSelecting(false);
    }
    setDraft(null);
  };

  async function ocrRegion(regionBox: Box, regionId: string) {
    setBusy("Reading text in region…");
    try {
      const { loadImage, toCanvas } = await import("@/lib/vision/image");
      const { runOcr } = await import("@/lib/vision/ocr");
      const el = await loadImage(imageUrl(img.key));
      const c = toCanvas(el, 2000, regionBox);
      const lines = await runOcr(c, { source: "region", region: regionBox, passes: 2 });
      const newClues: Clue[] = lines.map((l) => ({ id: uid("clue"), imageId: img.id, regionId, type: "text", label: l.uncertain ? "Text in region (uncertain)" : "Text in region", value: l.text, weight: l.confidence / 100, box: l.box, origin: "ocr", engine: l.engine }));
      ws.update((i) => ({ ...i, clues: [...i.clues, ...newClues] }));
      ws.log(`Region OCR: ${lines.length} lines${lines.length ? ` — “${lines.slice(0, 3).map((l) => l.text).join("”, “")}”` : ""}`);
    } catch (e) {
      ws.log(`Region OCR failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(null);
    }
  }

  async function addImages(files: FileList) {
    setBusy("Uploading…");
    try {
      const { compressForUpload } = await import("@/lib/vision/image");
      const { readExif } = await import("@/lib/vision/features");
      const added: ImageRecord[] = [];
      for (const f of Array.from(files).slice(0, 12)) {
        const exif = await readExif(f);
        const { blob, width, height } = await compressForUpload(f);
        const { image } = await api.upload(inv.id, blob, { name: f.name, width, height });
        if (exif) image.analysis = { analyzedAt: nowIso(), engines: ["exifr"], scene: [], objects: [], ocr: [], colors: [], brightness: 0, skyShare: 0, indoorLikely: null, exif, warnings: [] };
        added.push(image);
      }
      ws.update((i) => ({ ...i, images: [...i.images, ...added] }));
      await ws.saveNow();
      ws.log(`${added.length} image(s) added. Re-run the investigation to combine them.`);
    } catch (e) {
      ws.log(`Upload failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(null);
    }
  }

  async function linkImages() {
    setBusy("Comparing images with each other…");
    try {
      const { loadImage, toCanvas } = await import("@/lib/vision/image");
      const clip = await import("@/lib/vision/clip");
      const { compareCanvases } = await import("@/lib/vision/compare");
      const data = await Promise.all(
        inv.images.map(async (im) => {
          const c = toCanvas(await loadImage(imageUrl(im.key)), 640);
          return { im, c, emb: await clip.imageEmbedding(c) };
        }),
      );
      const out: { a: string; b: string; reasons: string[] }[] = [];
      const words = (id: string) => new Set(inv.clues.filter((c) => c.imageId === id && c.type === "text" && !c.ignored).flatMap((c) => c.value.toLowerCase().split(/\W+/).filter((w) => w.length >= 4)));
      for (let i = 0; i < data.length; i++)
        for (let j = i + 1; j < data.length; j++) {
          const cmp = compareCanvases(data[i].c, data[j].c, data[i].emb, data[j].emb);
          const reasons: string[] = [];
          if (cmp.overall !== "none") reasons.push(`${cmp.overall} visual similarity${cmp.structure && cmp.structure > 0.85 ? " (similar geometry)" : ""}`);
          const shared = [...words(data[i].im.id)].filter((w) => words(data[j].im.id).has(w));
          if (shared.length) reasons.push(`shared text: ${shared.slice(0, 4).join(", ")}`);
          const sa = new Set(inv.clues.filter((c) => c.imageId === data[i].im.id && c.type === "architecture").map((c) => c.value));
          const sharedArch = inv.clues.filter((c) => c.imageId === data[j].im.id && c.type === "architecture" && sa.has(c.value)).map((c) => c.value);
          if (sharedArch.length) reasons.push(`same architectural style: ${sharedArch[0]}`);
          const ga = data[i].im.analysis?.exif;
          const gb = data[j].im.analysis?.exif;
          if (ga?.lat !== undefined && gb?.lat !== undefined) {
            const km = Math.hypot(ga.lat - gb.lat!, (ga.lng! - gb.lng!) * Math.cos((ga.lat * Math.PI) / 180)) * 111;
            reasons.push(km < 1 ? `GPS within ${Math.round(km * 1000)} m` : `GPS ${km.toFixed(1)} km apart`);
          }
          out.push({ a: data[i].im.id, b: data[j].im.id, reasons: reasons.length ? reasons : ["no shared clues found"] });
        }
      setLinks(out);
    } catch (e) {
      ws.log(`Image linking failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(null);
    }
  }

  const grouped = clues.reduce<Record<string, Clue[]>>((acc, c) => ((acc[c.type] ||= []).push(c), acc), {});
  const nameOf = (id: string) => `IMG ${String(inv.images.findIndex((i) => i.id === id) + 1).padStart(2, "0")}`;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[1fr_340px]">
      <div className="flex min-h-0 flex-col">
        {/* filmstrip */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-3 py-2">
          {inv.images.map((im, i) => (
            <button key={im.id} onClick={() => setActiveId(im.id)} className={cn("relative shrink-0 overflow-hidden rounded-[3px] border", im.id === img.id ? "border-cyan" : "border-line opacity-70 hover:opacity-100")} title={im.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(im.key)} alt={im.name} className="h-12 w-16 object-cover" />
              <span className="label-mono absolute bottom-0 left-0 bg-black/80 px-1 !text-[8px]">
                {String(i + 1).padStart(2, "0")}
                {im.enhancedFrom ? " ENH" : ""}
              </span>
            </button>
          ))}
          <button onClick={() => fileRef.current?.click()} className="grid h-12 w-16 shrink-0 place-items-center rounded-[3px] border border-dashed border-line-strong text-mute hover:text-fg" title="Add images" aria-label="Add images">
            <ImagePlus className="size-4" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addImages(e.target.files)} />
          {inv.images.length > 1 && (
            <Button size="sm" variant="ghost" onClick={linkImages} disabled={Boolean(busy)}>
              <Link2 className="size-3.5" /> Link images
            </Button>
          )}
        </div>
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
          <Button size="sm" variant={selecting ? "subtle" : "ghost"} onClick={() => setSelecting((s) => !s)} aria-pressed={selecting} disabled={rot !== 0}>
            <SquareDashedMousePointer className="size-3.5" /> Select region
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Zoom in">
            <Plus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))} aria-label="Zoom out">
            <Minus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Rotate view">
            <RotateCw className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (setZoom(1), setPan({ x: 0, y: 0 }), setRot(0))}>
            Fit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowBoxes((s) => !s)}>
            {showBoxes ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} Overlays
          </Button>
          <div className="flex-1" />
          <ReverseSearch imageKey={img.key} />
          <Button size="sm" variant="ghost" onClick={() => setEnhance({ open: true })}>
            <Wand2 className="size-3.5" /> Enhance image
          </Button>
          <Button size="sm" variant="ghost" disabled={running} onClick={() => ws.start({ focus: { imageId: img.id, instruction: `Analyse image ${nameOf(img.id)} only` } })}>
            <ScanSearch className="size-3.5" /> Analyze this image
          </Button>
        </div>
        {/* viewer */}
        <div className="relative min-h-[320px] flex-1 overflow-hidden bg-[#050607] hairline-grid" onWheel={(e) => setZoom((z) => Math.min(6, Math.max(0.5, z * (e.deltaY < 0 ? 1.1 : 0.9))))}>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rot}deg)`, aspectRatio: aspect, maxHeight: "100%", maxWidth: "100%" }} className="relative h-full touch-none">
              <div ref={box} className={cn("relative h-full w-full", selecting ? "cursor-crosshair" : "cursor-grab")} style={{ aspectRatio: aspect }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(img.key)} alt={img.name} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" />
                {showBoxes &&
                  clues
                    .filter((c) => c.box)
                    .map((c) => (
                      <div key={c.id} title={`${c.type}: ${c.value}`} className={cn("pointer-events-none absolute border", c.ignored ? "border-white/20" : c.type === "text" ? "border-signal" : "border-cyan")} style={{ left: `${c.box!.x * 100}%`, top: `${c.box!.y * 100}%`, width: `${c.box!.w * 100}%`, height: `${c.box!.h * 100}%` }}>
                        <span className={cn("absolute -top-[13px] left-0 max-w-[220px] truncate whitespace-nowrap px-0.5 font-mono text-[8.5px] leading-[12px] text-ink", c.type === "text" ? "bg-signal" : "bg-cyan")}>{c.type === "text" ? c.value : c.value.toUpperCase()}</span>
                      </div>
                    ))}
                {regions.map((r) => (
                  <div key={r.id} className="pointer-events-none absolute border-2 border-dashed border-warn" style={{ left: `${r.box.x * 100}%`, top: `${r.box.y * 100}%`, width: `${r.box.w * 100}%`, height: `${r.box.h * 100}%` }}>
                    <span className="label-mono absolute -bottom-4 left-0 bg-warn px-1 !text-[8.5px] text-ink">{r.label}</span>
                  </div>
                ))}
                {draft && <div className="pointer-events-none absolute border-2 border-cyan bg-cyan/10" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
              </div>
            </div>
          </div>
          {selecting && <div className="label-mono absolute left-3 top-3 rounded bg-black/80 px-2 py-1 text-cyan">Drag to draw a region</div>}
          {busy && (
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded bg-black/80 px-2.5 py-1.5 text-[12px] text-cyan">
              <Loader2 className="size-3.5 animate-spin" /> {busy}
            </div>
          )}
          {img.demoSource && (
            <a href={img.demoSource.url} target="_blank" rel="noreferrer" className="absolute bottom-3 right-3 max-w-[60%] truncate rounded bg-black/80 px-2 py-1 text-[10.5px] text-mute hover:text-fg">
              Demo image: {img.demoSource.title.replace("File:", "")} · {img.demoSource.license}
              {img.demoSource.author ? ` · ${img.demoSource.author}` : ""} · Wikimedia Commons
            </a>
          )}
        </div>
        {regions.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line p-3">
            {regions.map((r) => (
              <div key={r.id} className="flex items-center gap-1 rounded-[5px] border border-warn/30 bg-warn/5 px-2 py-1">
                <span className="mr-1 text-[12px] text-warn">{r.label}</span>
                <Button size="sm" variant="ghost" disabled={running} onClick={() => ws.start({ focus: { imageId: r.imageId, regionId: r.id, instruction: `Investigate region “${r.label}”` } })}>
                  <ScanSearch className="size-3" /> Investigate region
                </Button>
                <Button size="sm" variant="ghost" onClick={() => ocrRegion(r.box, r.id)}>
                  <ScanText className="size-3" /> OCR
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEnhance({ open: true, crop: r.box })}>
                  <Crop className="size-3" /> Crop & enhance
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const t = inv.clues.filter((c) => c.regionId === r.id && c.type === "text").map((c) => c.value).join(" ");
                    if (t) void ws.search("web", t, { userAdded: true });
                    else ws.log("Run OCR on the region first to get searchable text.", "warn");
                  }}
                >
                  <Search className="size-3" /> Search
                </Button>
                <button className="ml-1 text-[11px] text-mute hover:text-alert" onClick={() => ws.update((i) => ({ ...i, regions: i.regions.filter((x) => x.id !== r.id) }))}>
                  remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* clue sidebar */}
      <div className="min-h-0 overflow-y-auto border-l border-line bg-panel">
        {links && (
          <Panel title="Multi-image links" className="m-3">
            <ul className="space-y-2 p-3 text-[12.5px]">
              {links.map((l, i) => (
                <li key={i}>
                  <span className="font-mono text-cyan">{nameOf(l.a)}</span> ↔ <span className="font-mono text-cyan">{nameOf(l.b)}</span>
                  <div className="text-dim">{l.reasons.join(" · ")}</div>
                </li>
              ))}
              {links.some((l) => !l.reasons[0].startsWith("no shared")) && <li className="pt-1 text-[12px] text-warn">These images may refer to the same location. Shared clues are combined in one investigation.</li>}
            </ul>
          </Panel>
        )}
        {img.analysis?.exif && (
          <div className="border-b border-line p-4">
            <Label className="mb-2">Photo metadata (EXIF, read in your browser)</Label>
            <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-[12px]">
              {img.analysis.exif.takenAt && (
                <>
                  <dt className="text-mute">Taken</dt>
                  <dd>{img.analysis.exif.takenAt.replace("T", " ").slice(0, 19)}</dd>
                </>
              )}
              {img.analysis.exif.lat !== undefined && (
                <>
                  <dt className="text-mute">GPS</dt>
                  <dd className="font-mono">
                    {img.analysis.exif.lat.toFixed(5)}, {img.analysis.exif.lng!.toFixed(5)}
                  </dd>
                </>
              )}
              {img.analysis.exif.model && (
                <>
                  <dt className="text-mute">Camera</dt>
                  <dd>
                    {img.analysis.exif.make} {img.analysis.exif.model}
                  </dd>
                </>
              )}
            </dl>
            <p className="mt-2 text-[11px] text-mute">Metadata can be edited or stripped, so treat it as strong but not infallible.</p>
          </div>
        )}
        {img.analysis?.colors?.length ? (
          <div className="border-b border-line p-4">
            <Label className="mb-2">Colour & light</Label>
            <div className="flex h-3 overflow-hidden rounded-[2px]">
              {img.analysis.colors.map((c) => (
                <span key={c.hex} style={{ background: c.hex, flex: c.share }} title={`${c.hex} ${(c.share * 100).toFixed(0)}%`} />
              ))}
            </div>
            <div className="mt-1.5 text-[11.5px] text-mute">
              Brightness {(img.analysis.brightness * 100).toFixed(0)}% · sky in top third {(img.analysis.skyShare * 100).toFixed(0)}% · {img.analysis.indoorLikely === true ? "likely indoors" : img.analysis.indoorLikely === false ? "likely outdoors" : "indoor/outdoor unclear"}
            </div>
          </div>
        ) : null}
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <Label>Clues ({clues.length})</Label>
            <span className="text-[11px] text-mute">click to ignore / restore</span>
          </div>
          {!clues.length && <p className="text-[12.5px] text-mute">Run the investigation to extract clues from this image.</p>}
          {Object.entries(grouped).map(([type, list]) => (
            <div key={type} className="mb-4">
              <div className="label-mono mb-1.5 !text-[9.5px] text-cyan">{type}</div>
              <ul className="space-y-1">
                {list
                  .sort((a, b) => b.weight - a.weight)
                  .map((c) => (
                    <li key={c.id}>
                      <button onClick={() => ws.toggleClue(c.id)} className={cn("flex w-full items-start gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.04]", c.ignored && "opacity-40 line-through")}>
                        <span className="min-w-0 flex-1 break-words">{c.value}</span>
                        <span className="shrink-0 font-mono text-[9.5px] text-mute" title={c.engine}>
                          {c.origin === "ai" ? "AI" : c.origin === "ocr" ? (c.label.includes("uncertain") ? "OCR?" : "OCR") : c.origin === "exif" ? "EXIF" : c.origin === "detector" ? "DET" : c.origin === "user" ? "USER" : "CLIP"}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {img.analysis?.ocr?.some((o) => o.uncertain) && (
            <p className="flex gap-1.5 text-[11.5px] text-mute">
              <Sparkles className="mt-0.5 size-3 shrink-0" /> “OCR?” marks low-confidence readings, which are used only as weak evidence. Text read from enhanced images is labelled separately from the original.
            </p>
          )}
        </div>
      </div>
      <EnhanceDialog open={enhance.open} crop={enhance.crop} image={img} onClose={() => setEnhance({ open: false })} />
    </div>
  );
}
