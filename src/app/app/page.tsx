"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ClipboardPaste, Files, ImagePlus, Play, ShieldCheck, Sparkles, Trash2, Upload } from "lucide-react";
import { Button, ConfidenceBadge, Label, cn, inputCls } from "@/components/ui";
import { CameraDialog } from "@/components/CameraDialog";
import { WorldMap } from "@/components/WorldMap";
import { api } from "@/lib/client/api";
import { EXAMPLES } from "@/lib/examples";
import type { ImageAnalysis, InvestigationMode, InvestigationSummary } from "@/lib/types";
import { MODES } from "@/lib/modes";


interface Picked {
  file: File;
  url: string;
  exif?: ImageAnalysis["exif"];
}

function NewInvestigation() {
  const router = useRouter();
  const params = useSearchParams();
  const [files, setFiles] = useState<Picked[]>([]);
  const [mode, setMode] = useState<InvestigationMode>("deep");
  const [custom, setCustom] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [recent, setRecent] = useState<InvestigationSummary[]>([]);
  const single = useRef<HTMLInputElement>(null);
  const multi = useRef<HTMLInputElement>(null);
  const demoStarted = useRef(false);

  useEffect(() => {
    api.list().then((r) => setRecent(r.investigations.slice(0, 6))).catch(() => undefined);
  }, []);

  const add = useCallback(async (list: File[]) => {
    const { readExif } = await import("@/lib/vision/features");
    const accepted = list.filter((f) => /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(f.type) || /\.(jpe?g|png|webp|gif)$/i.test(f.name));
    if (accepted.length < list.length) setError("Some files were skipped: only JPEG, PNG, WebP and GIF images are supported.");
    const picked = await Promise.all(accepted.slice(0, 12).map(async (file) => ({ file, url: URL.createObjectURL(file), exif: await readExif(file) })));
    setFiles((cur) => [...cur, ...picked].slice(0, 12));
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.files || []);
      if (items.length) add(items);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add]);

  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const out: File[] = [];
      for (const it of items) for (const t of it.types) if (t.startsWith("image/")) out.push(new File([await it.getType(t)], `pasted.${t.split("/")[1]}`, { type: t }));
      if (out.length) add(out);
      else setError("No image found on the clipboard. You can also press Ctrl/⌘+V anywhere on this page.");
    } catch {
      setError("Clipboard access was blocked. Press Ctrl/⌘+V on this page instead.");
    }
  };

  async function start() {
    if (!files.length) return;
    if (mode === "custom" && custom.trim().length < 4) {
      setError("Describe what TRACE should investigate for a custom investigation.");
      return;
    }
    setError(null);
    try {
      setBusy("Creating investigation…");
      const title = files.length > 1 ? `Multi-image investigation (${files.length})` : `Investigation — ${files[0].file.name.replace(/\.[a-z]+$/i, "").slice(0, 60)}`;
      const { investigation } = await api.create({ title, mode, customInstructions: mode === "custom" ? custom.trim() : undefined });
      const { compressForUpload } = await import("@/lib/vision/image");
      for (let i = 0; i < files.length; i++) {
        setBusy(`Uploading image ${i + 1} of ${files.length}…`);
        const f = files[i];
        const { blob, width, height } = await compressForUpload(f.file);
        const { image } = await api.upload(investigation.id, blob, { name: f.file.name, width, height });
        if (f.exif) image.analysis = { analyzedAt: new Date().toISOString(), engines: ["exifr"], scene: [], objects: [], ocr: [], colors: [], brightness: 0, skyShare: 0, indoorLikely: null, exif: f.exif, warnings: [] };
        investigation.images.push(image);
      }
      setBusy("Starting…");
      await api.save(investigation);
      router.push(`/app/i/${investigation.id}?run=1`);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const startExample = useCallback(
    async (id: string) => {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (!ex) return;
      setError(null);
      try {
        setBusy(`Preparing example: ${ex.label}…`);
        const { investigation } = await api.create({ title: `Example — ${ex.label}`, mode: ex.mode, demo: true });
        setBusy("Downloading public sample image from Wikimedia Commons…");
        const { image } = await api.importExample(investigation.id, ex.id);
        investigation.images.push(image);
        await api.save(investigation);
        router.push(`/app/i/${investigation.id}?run=1`);
      } catch (e) {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [router],
  );

  useEffect(() => {
    const demo = params.get("demo");
    if (demo && !demoStarted.current) {
      demoStarted.current = true;
      void startExample(demo);
    }
  }, [params, startExample]);

  return (
    <div className="relative flex-1 overflow-y-auto">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden opacity-60">
        <WorldMap className="h-full w-full" arcs={4} intensity={0.7} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/60 to-bg" />
      </div>
      <div className="relative mx-auto max-w-5xl px-5 pb-20 pt-10 md:px-8 md:pt-14">
        <div className="label-mono mb-3 text-cyan">New investigation</div>
        <h1 className="text-[clamp(30px,4.6vw,52px)] font-semibold leading-[1.02] tracking-[-0.035em]">Turn an image into an investigation.</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-dim">Upload an image. TRACE extracts clues, searches public information, compares evidence, and builds a visual investigation.</p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            add(Array.from(e.dataTransfer.files));
          }}
          className={cn("relative mt-8 overflow-hidden rounded-card border border-dashed bg-panel/70 backdrop-blur transition-colors", drag ? "border-cyan bg-cyan/[0.06]" : "border-line-strong")}
        >
          {!files.length ? (
            <button onClick={() => single.current?.click()} className="flex w-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
              <div className="relative grid size-16 place-items-center rounded-full border border-line-strong">
                <span className="pulse-ring absolute inset-0 rounded-full border border-cyan/50" />
                <ImagePlus className="size-6 text-cyan" />
              </div>
              <div>
                <div className="text-[19px] font-semibold tracking-tight">Drop an image to investigate</div>
                <div className="mt-1 text-[13px] text-mute">JPEG, PNG, WebP · up to 12 images · paste with Ctrl/⌘+V</div>
              </div>
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
              <AnimatePresence>
                {files.map((f, i) => (
                  <motion.figure key={f.url} layout initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="group relative overflow-hidden rounded-[5px] border border-line bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.file.name} className="aspect-[4/3] w-full object-cover" />
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-6">
                      <div className="truncate text-[11.5px]">{f.file.name}</div>
                      <div className="label-mono !text-[8.5px] text-mute">
                        IMG {String(i + 1).padStart(2, "0")} {f.exif?.lat !== undefined && "· GPS"} {f.exif?.takenAt && `· ${f.exif.takenAt.slice(0, 10)}`}
                      </div>
                    </figcaption>
                    <button aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((c) => c.filter((x) => x !== f))} className="absolute right-1.5 top-1.5 rounded bg-black/70 p-1 text-dim opacity-0 transition-opacity hover:text-alert group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="size-3.5" />
                    </button>
                  </motion.figure>
                ))}
              </AnimatePresence>
              <button onClick={() => multi.current?.click()} className="grid aspect-[4/3] place-items-center rounded-[5px] border border-dashed border-line-strong text-mute hover:text-fg">
                <span className="flex flex-col items-center gap-1 text-[12px]">
                  <ImagePlus className="size-5" /> Add image
                </span>
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <Button onClick={() => single.current?.click()}>
              <Upload className="size-4" /> Upload Image
            </Button>
            <Button onClick={pasteFromClipboard}>
              <ClipboardPaste className="size-4" /> Paste Image
            </Button>
            <Button onClick={() => setCamera(true)}>
              <Camera className="size-4" /> Camera
            </Button>
            <Button onClick={() => multi.current?.click()}>
              <Files className="size-4" /> Upload Multiple Images
            </Button>
            <div className="flex-1" />
            <Button variant="primary" size="lg" onClick={start} disabled={!files.length} loading={Boolean(busy)}>
              <Play className="size-4" /> Start Investigation
            </Button>
          </div>
          <input ref={single} type="file" accept="image/*" hidden onChange={(e) => e.target.files && add(Array.from(e.target.files))} />
          <input ref={multi} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && add(Array.from(e.target.files))} />
        </div>

        {(busy || error) && (
          <div role="status" className={cn("mt-3 rounded-[5px] border px-3 py-2 text-[13px]", error ? "border-alert/30 bg-alert/10 text-alert" : "border-cyan/30 bg-cyan/5 text-cyan")}>
            {error || busy}
          </div>
        )}

        <div className="mt-8">
          <Label className="mb-3">Investigation mode</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id} className={cn("rounded-[5px] border px-3 py-2.5 text-left transition-colors", mode === m.id ? "border-cyan/60 bg-cyan/[0.07]" : "border-line bg-panel hover:border-line-strong")}>
                <div className="text-[13px] font-medium">{m.label}</div>
                <div className="mt-0.5 text-[11.5px] text-mute">{m.blurb}</div>
              </button>
            ))}
          </div>
          {mode === "custom" && <textarea value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Identify the stadium and the year this photo was likely taken" className={cn(inputCls, "mt-3 h-20 py-2")} />}
        </div>

        <div className="mt-12">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <Label>Try an example investigation</Label>
              <p className="mt-1 text-[12.5px] text-mute">Real public photos from Wikimedia Commons, run through the full live pipeline. Labelled as demo data.</p>
            </div>
            <Sparkles className="size-4 text-cyan" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {EXAMPLES.map((ex) => (
              <button key={ex.id} disabled={Boolean(busy)} onClick={() => startExample(ex.id)} className={cn("group rounded-[5px] border bg-panel px-3 py-3 text-left transition-colors hover:border-cyan/50", ex.featured ? "border-cyan/30" : "border-line")}>
                <div className="flex items-center justify-between text-[13px] font-medium">
                  {ex.label}
                  <Play className="size-3 text-mute group-hover:text-cyan" />
                </div>
                <div className="mt-1 text-[11.5px] leading-snug text-mute">{ex.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        {recent.length > 0 && (
          <div className="mt-12">
            <div className="mb-3 flex items-center justify-between">
              <Label>Recent investigations</Label>
              <Link href="/app/investigations" className="text-[12px] text-dim hover:text-fg">
                View all →
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((r) => (
                <Link key={r.id} href={`/app/i/${r.id}`} className="flex gap-3 rounded-[5px] border border-line bg-panel p-2.5 hover:border-line-strong">
                  {r.thumbKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/images/${r.thumbKey}`} alt="" className="size-14 shrink-0 rounded-[3px] object-cover" loading="lazy" />
                  ) : (
                    <div className="size-14 shrink-0 rounded-[3px] bg-white/5" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{r.title}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-mute">{r.headline || r.status}</div>
                    <div className="mt-1">
                      <ConfidenceBadge value={r.confidence} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 flex items-start gap-3 rounded-card border border-line bg-panel p-4 text-[12.5px] leading-relaxed text-dim">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
          <div>
            TRACE researches public places, venues, organizations, objects and documents. It does not use facial recognition, does not identify private individuals, and does not reveal information about residents.{" "}
            <Link href="/privacy" className="text-cyan hover:underline">
              Privacy & Responsible Research
            </Link>
          </div>
        </div>
      </div>
      <CameraDialog open={camera} onClose={() => setCamera(false)} onCapture={(f) => add([f])} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewInvestigation />
    </Suspense>
  );
}
