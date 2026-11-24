"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeft, Camera, Download, Pause, Play, RotateCcw, Video } from "lucide-react";
import { Button } from "../ui/button";
import { Badge, Card } from "../ui/misc";
import { useToast } from "../ui/toast";
import { cn } from "@/lib/utils";

export type ReplayPoint = { t: number; id: string; name: string; lat: number; lng: number; category: string | null; city: string | null; email: string | null; phone: string | null; website: string | null };
export type ReplayData = { kind: string; id: string; title: string; status: string; startedAt: string; finishedAt: string | null; points: ReplayPoint[]; withoutLocation: number };

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const LENGTHS = [15, 30, 60, 120];
const fmtDate = (d: Date) => d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

/** Redraws a finished (or running) search: businesses appear on the map in the order they were found. */
export function SearchReplay({ data, liveHref }: { data: ReplayData; liveHref: string }) {
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const [pos, setPos] = useState(0); // replay clock, 0..1
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const raf = useRef(0);
  const last = useRef(0);
  const posRef = useRef(0);
  posRef.current = pos;

  const pts = data.points;
  const span = Math.max(1, pts.length ? pts[pts.length - 1]!.t : 1);
  const start = new Date(data.startedAt);
  const shown = useMemo(() => {
    const cut = pos * span;
    let lo = 0, hi = pts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid]!.t <= cut) lo = mid + 1; else hi = mid; }
    return lo;
  }, [pos, span, pts]);
  const visible = pts.slice(0, shown);
  const emails = visible.filter((p) => p.email).length;
  const phones = visible.filter((p) => p.phone).length;
  const clock = new Date(start.getTime() + pos * span);

  // Map setup (canvas keeps its pixels so frames can be recorded and saved as photos).
  useEffect(() => {
    let dead = false;
    import("maplibre-gl").then((ml) => {
      if (dead || !box.current) return;
      const m = new ml.Map({ container: box.current, style: STYLE, center: [-79.5, 43.7], zoom: 8, attributionControl: { compact: true }, canvasContextAttributes: { preserveDrawingBuffer: true } });
      map.current = m;
      m.on("load", () => {
        m.addSource("pts", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "pts", type: "circle", source: "pts", paint: { "circle-radius": ["case", ["get", "fresh"], 8, 4.5], "circle-color": ["case", ["get", "email"], "#4f46e5", "#0ea5e9"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5, "circle-opacity": 0.95 } });
        m.addLayer({ id: "names", type: "symbol", source: "pts", filter: ["get", "label"], layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#1e1b4b", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
        if (pts.length) {
          const lngs = pts.map((p) => p.lng), lats = pts.map((p) => p.lat);
          m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 13, duration: 0 });
        }
        setReady(true);
      });
    });
    return () => {
      dead = true;
      map.current?.remove();
    };
  }, [pts]);

  // Draw the businesses found up to the replay clock; the newest few are bigger and labelled.
  useEffect(() => {
    const src = map.current?.getSource("pts") as { setData?: (d: unknown) => void } | undefined;
    if (!ready || !src?.setData) return;
    src.setData({
      type: "FeatureCollection",
      features: visible.map((p, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { name: p.name, email: Boolean(p.email), fresh: i >= visible.length - 6, label: i >= visible.length - 3 } })),
    });
  }, [ready, visible]);

  const tick = useCallback((now: number) => {
    const dt = last.current ? now - last.current : 16;
    last.current = now;
    const next = Math.min(1, posRef.current + dt / (seconds * 1000));
    setPos(next);
    if (next < 1) raf.current = requestAnimationFrame(tick);
    else setPlaying(false);
  }, [seconds]);
  useEffect(() => {
    if (!playing) return;
    last.current = 0;
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, tick]);

  /** The map plus a caption (search, date, running count), drawn onto one canvas for photos and video. */
  const compose = (out: HTMLCanvasElement) => {
    const mc = map.current?.getCanvas();
    if (!mc) return;
    out.width = mc.width;
    out.height = mc.height;
    const g = out.getContext("2d")!;
    g.drawImage(mc, 0, 0);
    const s = out.width / 1200;
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.fillRect(16 * s, 16 * s, 560 * s, 96 * s);
    g.fillStyle = "#111827";
    g.font = `600 ${20 * s}px system-ui, sans-serif`;
    g.fillText(data.title.slice(0, 52), 30 * s, 46 * s);
    g.font = `${16 * s}px system-ui, sans-serif`;
    g.fillStyle = "#374151";
    const n = Number(out.dataset.count ?? 0);
    g.fillText(`${fmtDate(new Date(out.dataset.clock ?? data.startedAt))} · ${n} businesses found`, 30 * s, 74 * s);
    g.fillStyle = "#4f46e5";
    g.fillText("WebScout AI · Search replay", 30 * s, 98 * s);
  };
  const stamp = (c: HTMLCanvasElement) => {
    c.dataset.count = String(shownRef.current);
    c.dataset.clock = clockRef.current.toISOString();
  };
  const shownRef = useRef(0);
  const clockRef = useRef(start);
  shownRef.current = shown;
  clockRef.current = clock;

  const download = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const fileBase = `webscout-search-${start.toISOString().slice(0, 10)}-${data.id.slice(-6)}`;

  const photo = () => {
    const c = document.createElement("canvas");
    stamp(c);
    compose(c);
    c.toBlob((b) => b && download(b, `${fileBase}-${shown}-businesses.png`), "image/png");
  };

  const record = async () => {
    if (!map.current || recording) return;
    const c = document.createElement("canvas");
    stamp(c);
    compose(c);
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    if (!type) return toast.error("Video recording isn't supported in this browser", "Try Chrome or Edge.");
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      download(new Blob(chunks, { type }), `${fileBase}.${type.includes("mp4") ? "mp4" : "webm"}`);
      setRecording(false);
      toast.success("Video saved", "Check your downloads folder.");
    };
    setRecording(true);
    setPos(0);
    setPlaying(true);
    rec.start(1000);
    const frame = () => {
      stamp(c);
      compose(c);
      if (posRef.current < 1) requestAnimationFrame(frame);
      else setTimeout(() => rec.state === "recording" && rec.stop(), 1500); // hold the final frame for a moment
    };
    requestAnimationFrame(frame);
  };

  const csv = () => {
    const head = ["Name", "Category", "City", "Phone", "Email", "Website", "Found at"];
    const q = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const rows = pts.map((p) => [p.name, p.category, p.city, p.phone, p.email, p.website, fmtDate(new Date(start.getTime() + p.t))].map(q).join(","));
    download(new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" }), `${fileBase}.csv`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/history" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft className="h-3.5 w-3.5" /> Search History</Link>
          <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
          <p className="mt-1 text-sm text-muted">Started {fmtDate(start)}{data.finishedAt ? ` · finished ${fmtDate(new Date(data.finishedAt))}` : " · still running"} · {pts.length} businesses on the map{data.withoutLocation ? ` (${data.withoutLocation} without a map position)` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={photo} disabled={!ready}><Camera className="h-4 w-4" /> Save photo</Button>
          <Button onClick={record} disabled={!ready || recording || !pts.length} loading={recording} loadingText="Recording…"><Video className="h-4 w-4" /> Record video</Button>
          <Button variant="outline" onClick={csv} disabled={!pts.length}><Download className="h-4 w-4" /> Leads (CSV)</Button>
          <Link href={liveHref} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted hover:text-fg">Open live view</Link>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="relative h-[560px]">
          <div ref={box} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-sm">
            <div className="text-xs text-muted">{fmtDate(clock)}</div>
            <div className="text-2xl font-semibold tabular-nums">{shown} <span className="text-sm font-normal text-muted">businesses found</span></div>
            <div className="mt-1 flex gap-3 text-xs"><span className="text-indigo-600">● {emails} with email</span><span className="text-sky-600">● {phones} with phone</span></div>
          </div>
          {visible.length > 0 && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-sm rounded-xl border border-border bg-surface/95 px-4 py-2 text-sm shadow-sm">
              <div className="text-xs text-muted">Just found</div>
              <div className="truncate font-medium">{visible[visible.length - 1]!.name}</div>
              <div className="truncate text-xs text-muted">{[visible[visible.length - 1]!.category, visible[visible.length - 1]!.city].filter(Boolean).join(" · ")}</div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => { if (pos >= 1) setPos(0); setPlaying((p) => !p); }} disabled={!ready || recording}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? "Pause" : pos > 0 && pos < 1 ? "Resume" : "Play"}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPlaying(false); setPos(0); }} disabled={recording} aria-label="Restart"><RotateCcw className="h-4 w-4" /></Button>
          </div>
          <input type="range" min={0} max={1000} value={Math.round(pos * 1000)} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value) / 1000); }} disabled={recording} className="flex-1 accent-[rgb(var(--accent))]" aria-label="Replay position" />
          <div className="flex items-center gap-1 text-xs text-muted">
            Replay length
            {LENGTHS.map((l) => (
              <button key={l} onClick={() => setSeconds(l)} disabled={recording} className={cn("rounded-md px-2 py-1 font-medium", seconds === l ? "bg-accent text-white" : "hover:bg-subtle")}>{l < 60 ? `${l}s` : `${l / 60} min`}</button>
            ))}
          </div>
        </div>
      </Card>
      <p className="text-xs text-muted">Purple pins have a confirmed email, blue pins have a phone number. <Badge tone="slate">{data.status.toLowerCase()}</Badge></p>
    </div>
  );
}
