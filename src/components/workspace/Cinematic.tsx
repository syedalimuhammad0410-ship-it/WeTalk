"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, BookMarked, Check, FastForward, MessageSquare, Network, Pause, Play, RotateCcw, X } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { PHASES } from "@/lib/engine/runner";
import { WorldMap, type MapLock, type MapPin } from "@/components/WorldMap";
import { ConfidenceBadge, cn } from "@/components/ui";
import { imageUrl, proxied } from "@/lib/client/api";
import type { Box, Clue } from "@/lib/types";
import { truncate } from "@/lib/util";

const DWELL = { fast: 1400, detailed: 3600 };

export function Cinematic() {
  const inv = useWorkspace((s) => s.inv);
  const phase = useWorkspace((s) => s.phase);
  const running = useWorkspace((s) => s.running);
  const cine = useWorkspace((s) => s.cinematic);
  const steps = useWorkspace((s) => s.steps);
  const liveClues = useWorkspace((s) => s.liveClues);
  const compares = useWorkspace((s) => s.compares);
  const animation = useWorkspace((s) => s.animation);
  const reduced = animation === "reduced";
  const [d, setD] = useState(0);
  const [tick, setTick] = useState(0);
  // after each new location fix, clear the stage for a few seconds so the map lock-on is visible
  const locateCount = useWorkspace((s) => s.locates.length);
  const [holdStage, setHoldStage] = useState(false);
  useEffect(() => {
    if (!locateCount || reduced) return;
    setHoldStage(true);
    const id = setTimeout(() => setHoldStage(false), 5200);
    return () => clearTimeout(id);
  }, [locateCount, reduced]);

  const target = running && !cine.replay ? Math.max(0, PHASES.findIndex((p) => p.id === phase)) : PHASES.length - 1;
  // restart on new run/replay
  useEffect(() => {
    setD(0);
    setTick(0);
  }, [cine.runToken]);
  useEffect(() => {
    if (cine.paused) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setD((cur) => (cur < target ? cur + 1 : cur));
    }, DWELL[cine.speed]);
    return () => clearInterval(id);
  }, [cine.paused, cine.speed, target]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === " ") {
        e.preventDefault();
        ws.set((s) => ({ cinematic: { ...s.cinematic, paused: !s.cinematic.paused } }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!inv) return null;
  const image = inv.images[0];
  const cur = PHASES[d];
  const lead = inv.candidates.find((c) => c.status === "leading");
  const clues = (liveClues.length ? liveClues : inv.clues).filter((c) => !c.ignored && (!image || !c.imageId || c.imageId === image.id));
  const runningStep = [...steps].reverse().find((s) => s.status === "running");

  function close() {
    ws.set((s) => ({ cinematic: { ...s.cinematic, open: false }, tab: s.inv?.conclusion ? "result" : s.tab }));
  }
  const skip = () => {
    if (running) setD(target);
    else close();
  };

  return (
    <motion.div className="fixed inset-0 z-[80] overflow-hidden bg-ink" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-label="Investigation sequence">
      <CinemaMap phase={d} />
      <div className="vignette pointer-events-none absolute inset-0" />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-40" />
      {!reduced && <div className="grain pointer-events-none absolute inset-0 overflow-hidden" />}

      {/* HUD top */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 md:p-6">
        <div className="label-mono hidden text-mute sm:block">
          <div className="text-cyan">TRACE // CASE {inv.id.slice(-6).toUpperCase()}</div>
          <div className="mt-1">{new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</div>
          {inv.demo && <div className="mt-1 text-warn">DEMO · PUBLIC SAMPLE DATA</div>}
        </div>
        <div className="flex-1 text-center">
          <div className="label-mono text-mute">
            PHASE {d + 1} / {PHASES.length}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={cur.id} initial={{ opacity: 0, letterSpacing: "0.5em", filter: "blur(6px)" }} animate={{ opacity: 1, letterSpacing: "0.22em", filter: "blur(0px)" }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.01 : 0.7 }} className="mt-1 font-mono text-[clamp(15px,2.2vw,24px)] font-semibold text-fg">
              {cur.label}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-1">
          <HudBtn label={cine.paused ? "Resume" : "Pause"} onClick={() => ws.set((s) => ({ cinematic: { ...s.cinematic, paused: !s.cinematic.paused } }))}>
            {cine.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </HudBtn>
          <HudBtn label="Skip" onClick={skip}>
            <FastForward className="size-4" />
          </HudBtn>
          <HudBtn label="Replay" onClick={() => ws.set((s) => ({ cinematic: { ...s.cinematic, replay: !running, paused: false, runToken: s.cinematic.runToken + 1 } }))}>
            <RotateCcw className="size-4" />
          </HudBtn>
          <button onClick={() => ws.set((s) => ({ cinematic: { ...s.cinematic, speed: s.cinematic.speed === "fast" ? "detailed" : "fast" } }))} className="label-mono ml-1 rounded-[4px] border border-line-strong px-2 py-1.5 text-dim hover:text-fg" title="Animation pace">
            {cine.speed === "fast" ? "Fast mode" : "Detailed mode"}
          </button>
          <HudBtn label="Close" onClick={close}>
            <X className="size-4" />
          </HudBtn>
        </div>
      </div>

      {/* Stage */}
      <div className="absolute inset-0 z-10 flex items-center justify-center px-4 pb-28 pt-24 md:px-10">
        <AnimatePresence mode="wait">
          {d <= 2 && image && <ImageStage key="img" phase={d} tick={tick} clues={clues} reduced={reduced} />}
          {d === 3 && <SearchStage key="search" reduced={reduced} />}
          {d === 4 && !holdStage && <CandidateStage key="cands" />}
          {d === 5 && !holdStage && <MatchStage key="match" compares={compares} />}
          {d === 6 && <CaseStage key="case" />}
          {d === 7 && <ResultStage key="result" onClose={close} running={running} />}
        </AnimatePresence>
      </div>

      <SourceCaption tick={tick} />
      {/* HUD bottom */}
      <div className="absolute inset-x-0 bottom-0 z-20 p-4 md:p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-3 flex gap-1">
            {PHASES.map((p, i) => (
              <button key={p.id} onClick={() => (i <= target ? setD(i) : undefined)} className="group flex-1" title={p.label} aria-label={`Go to phase ${p.label}`}>
                <div className={cn("h-[3px] rounded-full transition-colors", i < d ? "bg-cyan/70" : i === d ? "bg-cyan" : i <= target ? "bg-white/25" : "bg-white/10")} />
                <div className={cn("label-mono mt-1.5 hidden truncate !text-[8.5px] md:block", i === d ? "text-cyan" : "text-mute")}>{p.label}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-dim">
            <span className="flex items-center gap-2">
              {running ? <span className="size-1.5 animate-pulse rounded-full bg-cyan" /> : <Check className="size-3 text-ok" />}
              {running ? runningStep?.label || "Working…" : "Investigation complete"}
              {cine.paused && <span className="text-warn">· PAUSED</span>}
            </span>
            <span className="text-mute">
              {inv.clues.length} clues · {inv.queries.length} queries · {inv.sources.length} sources · {inv.candidates.length} candidates
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Documentary-style citation caption: “[n] : Source title (year)”. */
function SourceCaption({ tick }: { tick: number }) {
  const inv = useWorkspace((s) => s.inv)!;
  const used = inv.sources.filter((s) => s.usedInReasoning || s.category !== "other").slice(0, 40);
  if (!used.length) return null;
  const s = used[tick % used.length];
  const n = inv.sources.indexOf(s) + 1;
  const year = s.publishedAt?.slice(0, 4);
  return (
    <AnimatePresence mode="wait">
      <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute bottom-[92px] left-4 z-20 max-w-[60vw] truncate font-mono text-[11px] text-white/70 md:left-6">
        [{n}] : {s.publisher} — {s.title}
        {year ? ` (${year})` : ""}
      </motion.div>
    </AnimatePresence>
  );
}

function HudBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-8 place-items-center rounded-[4px] border border-line-strong bg-black/30 text-dim hover:text-fg">
      {children}
    </button>
  );
}

const PRECISION_ZOOM: Record<string, number> = { exact: 15, street: 13, neighbourhood: 10, city: 7.5, region: 4.2, country: 2.8 };

/** Possible locations to "lock on" to: live AI geolocation fixes, or (on replay) the AI candidates saved in the case. */
function useLocks() {
  const inv = useWorkspace((s) => s.inv)!;
  const live = useWorkspace((s) => s.locates);
  return useMemo(() => {
    if (live.length) return live.map((l) => ({ ...l, label: l.name }));
    return inv.candidates
      .map((c) => ({ c, l: inv.locations.find((l) => l.id === c.locationId) }))
      .filter((x) => x.l && (x.c.signals.ai ?? 0) > 0)
      .map(({ c, l }) => ({ name: c.name, label: c.name, lat: l!.lat, lng: l!.lng, precision: l!.kind.startsWith("ai-") ? l!.kind.slice(3) : "exact", confidence: c.signals.ai ?? 0, confirmed: !c.against.some((a) => /could not confirm|unconfirmed/i.test(a)) }));
  }, [live, inv.candidates, inv.locations]);
}

function CinemaMap({ phase }: { phase: number }) {
  const inv = useWorkspace((s) => s.inv)!;
  const locks = useLocks();
  const [li, setLi] = useState(0);
  const t0 = useRef(0);
  const lockPhase = phase === 4 || phase === 5;
  useEffect(() => {
    if (!lockPhase || locks.length < 2) return;
    const id = setInterval(() => setLi((i) => i + 1), 4600);
    return () => clearInterval(id);
  }, [lockPhase, locks.length]);
  const cur = lockPhase && locks.length ? locks[li % locks.length] : null;
  const curKey = cur ? `${cur.name}|${li % locks.length}` : "";
  const lastKey = useRef("");
  if (curKey !== lastKey.current) {
    lastKey.current = curKey;
    t0.current = typeof performance !== "undefined" ? performance.now() : 0;
  }
  const lock: MapLock | null = cur ? { lat: cur.lat, lng: cur.lng, label: cur.label, t0: t0.current, confirmed: cur.confirmed } : null;
  const pins: MapPin[] = useMemo(
    () =>
      inv.candidates
        .map((c) => ({ c, l: inv.locations.find((l) => l.id === c.locationId) }))
        .filter((x) => x.l)
        .map(({ c, l }) => ({ lat: l!.lat, lng: l!.lng, label: phase >= 4 ? truncate(c.name, 26) : undefined, color: c.status === "leading" ? "#ff7a45" : c.status === "rejected" ? "#646d77" : "#59d4e8", strong: c.status === "leading" })),
    [inv.candidates, inv.locations, phase],
  );
  const lead = pins.find((p) => p.strong) || pins[0];
  const center = lock ? { lat: lock.lat, lng: lock.lng } : phase >= 4 && lead ? { lat: lead.lat, lng: lead.lng } : { lat: 22, lng: phase * 25 - 60 };
  const zoom = cur ? PRECISION_ZOOM[cur.precision] ?? 7 : phase === 4 ? (pins.length > 1 ? spreadZoom(pins) : 5) : phase >= 5 && lead ? 6 : 1.15;
  return (
    <>
      <WorldMap className={cn("absolute inset-0 h-full w-full transition-opacity duration-1000", phase >= 4 ? "opacity-100" : "opacity-45")} pins={phase >= 4 ? pins.filter((p) => !lock || Math.abs(p.lat - lock.lat) > 1e-4 || Math.abs(p.lng - lock.lng) > 1e-4) : []} center={center} zoom={zoom} drift={phase < 4} arcs={phase === 3 ? 14 : 5} intensity={phase >= 4 ? 1.6 : 1} radar={!lock && (phase === 4 || phase === 5)} lock={lock} />
      {/* teal duotone grade for the geographic phases */}
      <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-1000", phase === 4 || phase === 5 ? "opacity-100" : "opacity-0")} style={{ background: "radial-gradient(ellipse at 50% 55%, rgba(110,220,200,0.16), rgba(10,40,36,0.35) 60%, rgba(0,0,0,0.6))", mixBlendMode: "screen" }} />
      <AnimatePresence mode="wait">{cur && <LockCard key={curKey} lock={cur} index={li % locks.length} total={locks.length} />}</AnimatePresence>
    </>
  );
}

/** HUD card for the location currently locked on. */
function LockCard({ lock, index, total }: { lock: { name: string; precision: string; confidence: number; confirmed: boolean; lat: number; lng: number }; index: number; total: number }) {
  const pct = Math.round(lock.confidence * 100);
  return (
    <motion.div initial={{ opacity: 0, x: 40, filter: "blur(6px)" }} animate={{ opacity: 1, x: 0, filter: "blur(0px)" }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.5 }} className="pointer-events-none absolute right-4 top-24 z-20 w-[min(320px,80vw)] border border-signal/50 bg-black/75 p-3 backdrop-blur md:right-6">
      <div className="flex items-center justify-between">
        <span className="label-mono !text-[9.5px] text-signal">⌖ POSSIBLE LOCATION {index + 1}/{total}</span>
        <span className={cn("label-mono !text-[9px]", lock.confirmed ? "text-ok" : "text-warn")}>{lock.confirmed ? "MAP-CONFIRMED" : "AI ESTIMATE"}</span>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="mt-1.5 text-[15px] font-semibold leading-tight">
        {lock.name}
      </motion.div>
      <div className="mt-1 font-mono text-[10.5px] text-dim">
        {lock.lat.toFixed(4)}, {lock.lng.toFixed(4)} · {lock.precision} precision
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <motion.div className={cn("h-full", lock.confirmed ? "bg-signal" : "bg-warn")} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: 0.6, duration: 1.4, ease: "easeOut" }} />
        </div>
        <span className="font-mono text-[10px] text-dim">{pct}% AI</span>
      </div>
    </motion.div>
  );
}

function spreadZoom(pins: MapPin[]) {
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lngs) - Math.min(...lngs)) / 1.6, 2);
  return Math.max(1.2, Math.min(7, 90 / span));
}

// ---------------- Phase 1–3: image, clues, OCR ----------------
function ImageStage({ phase, tick, clues, reduced }: { phase: number; tick: number; clues: Clue[]; reduced: boolean }) {
  const inv = useWorkspace((s) => s.inv)!;
  const focus = useWorkspace((s) => s.focus);
  const image = inv.images[0];
  const aspect = image.width && image.height ? image.width / image.height : 4 / 3;
  const boxed = clues.filter((c) => c.box && c.type !== "text").slice(0, 8);
  const texts = clues.filter((c) => c.type === "text" && c.box).sort((a, b) => b.weight - a.weight).slice(0, 6);
  const tags = clues.filter((c) => !c.box && ["scene", "architecture", "environment", "sport", "logo", "exif", "date"].includes(c.type)).slice(0, 7);
  let cam = { scale: 1, x: "0%", y: "0%" };
  if (!reduced) {
    if (phase === 0) cam = { scale: 1.06, x: "0%", y: "0%" };
    if (phase === 2) {
      const target: Box | undefined = (focus?.box && focus.imageId === image.id ? focus.box : undefined) || texts[tick % Math.max(1, texts.length)]?.box;
      if (target) {
        const s = 1.7;
        const cx = target.x + target.w / 2;
        const cy = target.y + target.h / 2;
        cam = { scale: s, x: `${-(cx - 0.5) * 100 * s}%`, y: `${-(cy - 0.5) * 100 * s}%` };
      }
    }
  }
  const meta = [`${image.width}×${image.height}`, `SHA ${image.sha256.slice(0, 12)}`, image.analysis?.exif?.takenAt ? `DATE ${image.analysis.exif.takenAt.slice(0, 10)}` : "NO DATE METADATA", image.analysis?.exif?.lat !== undefined ? "GPS PRESENT" : "NO GPS"];
  return (
    <motion.div className="relative flex h-full w-full items-center justify-center [perspective:1600px]" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8, x: "-30%" }} transition={{ duration: reduced ? 0.01 : 0.9, ease: [0.2, 0.7, 0.2, 1] }}>
      {/* shallow depth of field: defocused plate behind the evidence */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(image.key)} alt="" aria-hidden className="pointer-events-none absolute inset-[-10%] h-[120%] w-[120%] scale-110 object-cover opacity-25 blur-2xl" />
      <div className="relative max-h-full overflow-hidden rounded-[4px] border border-white/15 shadow-[0_30px_120px_rgba(0,0,0,0.8),0_0_80px_rgba(89,212,232,0.12)] transition-transform duration-[2000ms]" style={{ aspectRatio: aspect, height: "min(100%, calc((100vw - 80px) / " + aspect + "))", transform: reduced ? undefined : phase === 0 ? "rotateY(-7deg) rotateX(3deg)" : "rotateY(0deg)" }}>
        <motion.div className="absolute inset-0" animate={cam} transition={{ duration: reduced ? 0 : 2.2, ease: [0.3, 0.1, 0.2, 1] }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(image.key)} alt={image.name} className="absolute inset-0 h-full w-full object-cover" />
          {phase >= 1 &&
            boxed.map((c, i) => (
              <motion.div key={c.id} className="absolute border border-cyan" style={{ left: `${c.box!.x * 100}%`, top: `${c.box!.y * 100}%`, width: `${c.box!.w * 100}%`, height: `${c.box!.h * 100}%` }} initial={{ opacity: 0, scale: 1.3 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: reduced ? 0 : i * 0.25 }}>
                <span className="label-mono absolute -top-4 left-0 whitespace-nowrap bg-cyan px-1 !text-[8.5px] text-ink">{c.type === "logo" ? "LOGO" : c.value.toUpperCase()}</span>
              </motion.div>
            ))}
          {phase >= 2 &&
            texts.map((c, i) => (
              <motion.div key={c.id} className="absolute border-[1.5px] border-signal bg-signal/10" style={{ left: `${c.box!.x * 100}%`, top: `${c.box!.y * 100}%`, width: `${c.box!.w * 100}%`, height: `${c.box!.h * 100}%` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduced ? 0 : 0.3 + i * 0.35 }}>
                <span className="absolute left-0 top-full mt-0.5 whitespace-nowrap bg-black/85 px-1 font-mono text-[9px] text-signal">
                  “{truncate(c.value, 30)}” · {Math.round(c.weight * 100)}%
                </span>
              </motion.div>
            ))}
        </motion.div>
        {phase === 2 && !reduced && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <motion.path d="M-5,78 Q 50,52 105,18" fill="none" stroke="#c4302b" strokeWidth={0.7} strokeLinecap="round" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.7))" }} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, delay: 0.4 }} />
          </svg>
        )}
        {/* scan line */}
        {!reduced && <motion.div className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-cyan/15 to-transparent" initial={{ top: "-20%" }} animate={{ top: "110%" }} transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }} />}
        <Corner />
      </div>
      {/* side tags */}
      <div className="pointer-events-none absolute left-0 top-1/2 hidden -translate-y-1/2 flex-col gap-2 xl:flex">
        {phase === 0 &&
          meta.map((m, i) => (
            <motion.div key={m} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.2 }} className="label-mono border-l-2 border-cyan/60 bg-black/60 px-2 py-1 text-dim">
              {m}
            </motion.div>
          ))}
        {phase >= 1 &&
          tags.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.18 }} className="max-w-[230px] border-l-2 border-cyan/60 bg-black/60 px-2 py-1">
              <div className="label-mono !text-[8.5px] text-cyan">{c.type}</div>
              <div className="truncate text-[12px] text-fg">{c.value}</div>
            </motion.div>
          ))}
      </div>
      {phase === 2 && (
        <div className="pointer-events-none absolute right-0 top-1/2 hidden w-[240px] -translate-y-1/2 flex-col gap-1.5 xl:flex">
          <div className="label-mono text-signal">OCR · detected text</div>
          {texts.length === 0 && <div className="text-[12px] text-mute">Reading…</div>}
          {texts.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.25 }} className="border-r-2 border-signal/70 bg-black/60 px-2 py-1 text-right font-mono text-[12px]">
              {c.value}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function Corner() {
  return (
    <div className="pointer-events-none absolute inset-2">
      <span className="absolute left-0 top-0 size-4 border-l-2 border-t-2 border-cyan/80" />
      <span className="absolute right-0 top-0 size-4 border-r-2 border-t-2 border-cyan/80" />
      <span className="absolute bottom-0 left-0 size-4 border-b-2 border-l-2 border-cyan/80" />
      <span className="absolute bottom-0 right-0 size-4 border-b-2 border-r-2 border-cyan/80" />
    </div>
  );
}

// ---------------- Phase 4: search tree ----------------
function SearchStage({ reduced }: { reduced: boolean }) {
  const inv = useWorkspace((s) => s.inv)!;
  const image = inv.images[0];
  const nodes = [
    ...inv.entities.slice(0, 4).map((e) => ({ id: e.id, label: e.name.toUpperCase(), sub: e.type.replace("_", " "), kind: "entity" })),
    ...inv.queries.filter((q) => q.kind !== "maps").slice(0, 7 - Math.min(4, inv.entities.length)).map((q) => ({ id: q.id, label: truncate(q.text, 34).toUpperCase(), sub: `${q.kind} · ${q.provider} · ${q.status}`, kind: "query" })),
  ].slice(0, 7);
  if (!nodes.length) nodes.push({ id: "pending", label: "SEARCHING…", sub: "building queries", kind: "query" });
  return (
    <motion.div className="relative grid h-full w-full max-w-5xl grid-cols-[minmax(120px,240px)_1fr] items-center gap-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div initial={{ x: 60, scale: 1.2 }} animate={{ x: 0, scale: 1 }} transition={{ duration: reduced ? 0 : 0.9 }} className="relative overflow-hidden rounded-[4px] border border-white/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={imageUrl(image.key)} alt="" className="aspect-[4/3] w-full object-cover" />}
        <div className="label-mono absolute bottom-0 left-0 bg-black/80 px-1.5 py-0.5 !text-[9px] text-cyan">IMAGE</div>
      </motion.div>
      <div className="relative flex flex-col gap-3">
        <svg className="pointer-events-none absolute -left-10 top-0 h-full w-10 overflow-visible" viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden>
          {nodes.map((n, i) => {
            const y = ((i + 0.5) / nodes.length) * 100;
            return <motion.path key={n.id} d={`M0,50 C 20,50 20,${y} 40,${y}`} stroke="rgba(89,212,232,0.6)" fill="none" strokeWidth={1.2} vectorEffect="non-scaling-stroke" className="dash-flow" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: i * 0.2, duration: 0.6 }} />;
          })}
        </svg>
        {nodes.map((n, i) => (
          <motion.div key={n.id} initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduced ? 0 : 0.2 + i * 0.22 }} className={cn("flex items-center gap-3 border bg-black/60 px-3 py-2 backdrop-blur", n.kind === "entity" ? "border-signal/50" : "border-cyan/30")}>
            <span className={cn("size-1.5 shrink-0 rounded-full", n.kind === "entity" ? "bg-signal" : "bg-cyan")} />
            <div className="min-w-0">
              <div className="truncate font-mono text-[12.5px] font-semibold tracking-wide">{n.label}</div>
              <div className="label-mono truncate !text-[8.5px] text-mute">{n.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ---------------- Phase 5: candidates ----------------
function CandidateStage() {
  const inv = useWorkspace((s) => s.inv)!;
  const cands = inv.candidates.slice(0, 6);
  return (
    <motion.div className="pointer-events-none flex h-full w-full items-end justify-start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="w-full max-w-sm space-y-1.5">
        <div className="label-mono mb-2 text-signal">Candidate locations · {inv.candidates.length}</div>
        {!cands.length && <div className="text-[13px] text-mute">Generating candidates…</div>}
        {cands.map((c, i) => (
          <motion.div key={c.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.25 }} className="flex items-center gap-3 border border-line-strong bg-black/70 px-3 py-2 backdrop-blur">
            <span className="font-mono text-[11px] text-mute">#{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{c.name}</div>
              <div className="truncate text-[11px] text-mute">{[c.city, c.country].filter(Boolean).join(", ") || c.kind}</div>
            </div>
            {c.activeFrom && (
              <span className="font-mono text-[10px] text-dim">
                {c.activeFrom.slice(0, 4)}–{c.activeTo?.slice(0, 4) || "now"}
              </span>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ---------------- Phase 6: matching ----------------
function MatchStage({ compares }: { compares: { candidateId: string; thumb: string; overall: string }[] }) {
  const inv = useWorkspace((s) => s.inv)!;
  const image = inv.images[0];
  const pairs = (compares.length ? compares : inv.candidates.flatMap((c) => c.images.filter((i) => i.comparison).map((i) => ({ candidateId: c.id, thumb: proxied(i.thumb), overall: i.comparison!.overall })))).slice(0, 4);
  return (
    <motion.div className="grid h-full w-full max-w-5xl grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto_1.3fr]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="relative overflow-hidden rounded-[4px] border border-white/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={imageUrl(image.key)} alt="" className="aspect-[4/3] w-full object-cover" />}
        <div className="label-mono absolute left-0 top-0 bg-black/80 px-1.5 py-0.5 !text-[9px] text-cyan">UPLOADED IMAGE</div>
      </div>
      <div className="label-mono hidden text-center text-dim md:block">VS</div>
      <div className="grid grid-cols-2 gap-2">
        {!pairs.length && <div className="col-span-2 text-[13px] text-mute">Retrieving reference photographs…</div>}
        {pairs.map((p, i) => {
          const c = inv.candidates.find((x) => x.id === p.candidateId);
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.3 }} className="relative overflow-hidden rounded-[4px] border border-white/15">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt="" className="aspect-[4/3] w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 to-transparent p-2 pt-6">
                <div className="truncate text-[11.5px]">{c?.name}</div>
                <div className={cn("label-mono !text-[9px]", p.overall === "strong" ? "text-ok" : p.overall === "moderate" ? "text-cyan" : p.overall === "weak" ? "text-warn" : "text-mute")}>MATCH · {p.overall === "none" ? "NO RESEMBLANCE" : `${p.overall} similarity`}</div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ---------------- Phase 7: building the case ----------------
const RING_ICON: Record<string, string> = { IMAGE: "◐", TEXT: "Aa", LOGO: "◆", LOCATION: "⌖" };

function CaseStage() {
  const inv = useWorkspace((s) => s.inv)!;
  const lead = inv.candidates.find((c) => c.status === "leading") || inv.candidates[0];
  const textEv = lead && inv.evidence.find((e) => e.candidateId === lead.id && e.clueIds.length && e.polarity === "supports");
  const clue = textEv && inv.clues.find((c) => c.id === textEv.clueIds[0]);
  const ent = lead && inv.entities.find((e) => lead.derivedFrom.includes(e.name));
  const loc = lead && inv.locations.find((l) => l.id === lead.locationId);
  const chain = [
    { k: "IMAGE", v: truncate(inv.images[0]?.name.replace(/\.[a-z]+$/i, "") || "", 18), thumb: inv.images[0] ? imageUrl(inv.images[0].key) : undefined },
    ...(clue ? [{ k: clue.type === "logo" ? "LOGO" : "TEXT", v: `“${truncate(clue.value, 18)}”` }] : []),
    ...(ent ? [{ k: ent.type.replace("_", " ").toUpperCase(), v: truncate(ent.name, 20) }] : []),
    ...(lead ? [{ k: (lead.kind || "PLACE").toUpperCase(), v: truncate(lead.name, 20), thumb: lead.images.find((i) => i.comparison)?.thumb ? proxied(lead.images.find((i) => i.comparison)!.thumb) : undefined }] : []),
    ...(loc ? [{ k: "LOCATION", v: `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}` }] : []),
  ];
  const clippings = inv.sources.filter((s) => s.usedInReasoning && s.excerpt && s.excerpt.length > 60).slice(0, 2);
  const step = 100 / Math.max(1, chain.length);
  return (
    <motion.div className="relative flex h-full w-full max-w-6xl flex-col items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* tilted evidence plane */}
      <div className="relative h-[52%] w-full [perspective:1300px]">
        <motion.div className="absolute inset-0 [transform-style:preserve-3d]" initial={{ rotateX: 55, rotateZ: -4, y: 60, opacity: 0 }} animate={{ rotateX: 28, rotateZ: -7, y: 0, opacity: 1 }} transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}>
          <div className="absolute inset-[-20%] [background-image:linear-gradient(rgba(255,255,255,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:90px_90px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]" />
          {/* red string */}
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <motion.polyline points={chain.map((_, i) => `${step * i + step / 2},${50 + (i % 2 ? -9 : 9)}`).join(" ")} fill="none" stroke="#c4302b" strokeWidth={0.5} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2.5, filter: "drop-shadow(0 2px 2px rgba(0,0,0,.8))" }} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: chain.length * 0.5, delay: 0.6 }} />
          </svg>
          {chain.map((n, i) => (
            <motion.div key={i} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: `${step * i + step / 2}%`, top: `${50 + (i % 2 ? -9 : 9)}%` }} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 + i * 0.45 }}>
              <div className="label-mono mb-2 whitespace-nowrap !text-[10px] !tracking-[0.3em] text-white/80">{n.k}</div>
              <div className={cn("relative grid size-[clamp(64px,9vw,112px)] place-items-center overflow-hidden rounded-full border-[3px] bg-black/70", i === chain.length - 1 || n.k === "LOCATION" ? "border-[#8fe36b] shadow-[0_0_28px_rgba(143,227,107,0.55)]" : "border-[#e2d94b] shadow-[0_0_28px_rgba(226,217,75,0.5)]")}>
                {n.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.thumb} alt="" className="h-full w-full object-cover opacity-80 grayscale" />
                ) : (
                  <span className="font-mono text-[clamp(16px,2vw,24px)] text-white/70">{RING_ICON[n.k] || "●"}</span>
                )}
              </div>
              <div className="mt-2 max-w-[150px] text-center text-[clamp(11px,1.2vw,15px)] font-bold uppercase tracking-wide text-white [text-shadow:0_0_12px_rgba(255,255,255,0.35)]">{n.v}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
      {/* pinned clippings from real sources */}
      {clippings.map((c, i) => (
        <motion.div
          key={c.id}
          className={cn("absolute hidden w-[230px] bg-[#ece6d6] p-3 text-[#1d1c19] shadow-[0_18px_40px_rgba(0,0,0,0.7)] xl:block", i === 0 ? "left-0 top-4" : "right-0 top-10")}
          style={{ rotate: i === 0 ? "-4deg" : "3deg", fontFamily: "Georgia, 'Times New Roman', serif" }}
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4 + i * 0.4 }}
        >
          <span className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full bg-[#c4302b] shadow" />
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider">{c.publisher}</div>
          <div className="text-[12.5px] font-bold leading-tight">{truncate(c.title, 70)}</div>
          <p className="mt-1.5 line-clamp-5 text-[10.5px] leading-snug">{c.excerpt}</p>
        </motion.div>
      ))}
      {lead?.falsification && (
        <div className="relative z-10 mt-4 w-full max-w-2xl space-y-1.5">
          <div className="label-mono text-signal">Trying to disprove the leading candidate</div>
          {lead.falsification.map((f, i) => (
            <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 + i * 0.35 }} className="flex items-start gap-2 bg-black/70 px-3 py-1.5 text-[12.5px] backdrop-blur">
              <span className={cn("label-mono mt-0.5 shrink-0 !text-[9px]", f.outcome === "passed" ? "text-ok" : f.outcome === "failed" ? "text-alert" : "text-warn")}>{f.outcome}</span>
              <span className="text-dim">{f.question}</span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ---------------- Phase 8: result ----------------
function ResultStage({ onClose, running }: { onClose: () => void; running: boolean }) {
  const inv = useWorkspace((s) => s.inv)!;
  const c = inv.conclusion;
  if (!c)
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-[14px] text-dim">
        {running ? "Finalising the case…" : "No result was produced."}
      </motion.div>
    );
  const go = (tab: "result" | "board" | "sources") => {
    ws.set({ tab });
    onClose();
  };
  return (
    <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8 }} className="w-full max-w-2xl border border-white/15 bg-black/75 p-6 backdrop-blur-md md:p-8">
      <div className="label-mono text-signal">Investigation result</div>
      <h2 className="mt-2 text-[clamp(22px,3.2vw,34px)] font-semibold leading-tight tracking-tight">{c.headline}</h2>
      <div className="mt-3">
        <ConfidenceBadge value={c.confidence} />
      </div>
      <ul className="mt-5 space-y-1.5">
        {c.reasons.slice(0, 4).map((r, i) => (
          <li key={i} className="flex gap-2 text-[13px] text-dim">
            <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
            {r}
          </li>
        ))}
        {c.uncertainties.slice(0, 2).map((r, i) => (
          <li key={`u${i}`} className="flex gap-2 text-[13px] text-dim">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
            {r.replace(/^⚠ /, "")}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={() => go("result")} className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-fg px-4 text-[13px] font-semibold text-ink">
          View full result
        </button>
        <button onClick={() => go("board")} className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line-strong px-3 text-[13px]">
          <Network className="size-3.5" /> Evidence board
        </button>
        <button onClick={() => go("sources")} className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line-strong px-3 text-[13px]">
          <BookMarked className="size-3.5" /> Sources ({inv.sources.length})
        </button>
        <button onClick={onClose} className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line-strong px-3 text-[13px]">
          <MessageSquare className="size-3.5" /> Ask TRACE AI
        </button>
      </div>
    </motion.div>
  );
}
