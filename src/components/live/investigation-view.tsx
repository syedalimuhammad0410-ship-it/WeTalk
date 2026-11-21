"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeft, Ban, Box, Building2, CheckCircle2, ChevronRight, Copy, ExternalLink, Globe, List, LocateFixed, Mail, MapPin, Pause, Phone, Play, Radio, Search, Sparkles, Star, X } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";

type Point = {
  id: string; name: string; lat: number | null; lng: number | null; category: string | null; city: string | null; address: string | null; website: string | null;
  phone: string | null; imageUrl: string | null; score: number | null; websiteClass: string | null; rating: number | null; reviews: number | null; discoveredAt: string; summary: string | null;
};
type LiveEvent = { id: string; type: string; message: string; createdAt: string; businessId: string | null };
export type Live = {
  kind: "claude" | "search"; id: string; shortId: string; title: string; status: string; progress: number; message: string | null; createdAt: string; startedAt: string | null;
  finishedAt: string | null; summary: string | null; error: string | null; say: string | null; stats: { key: string; label: string; value: number }[]; events: LiveEvent[]; points: Point[];
  area: { center: [number, number]; bounds?: [[number, number], [number, number]] } | null; controls: { pause: boolean; resume: boolean; cancel: boolean }; detailsHref: string; backHref: string;
};
type Profile = {
  id: string; name: string; category: string | null; whatTheyDo: string | null; services: string | null; address: string | null; city: string | null; phone: string | null; website: string | null;
  email: string | null; rating: number | null; reviews: number | null; lat: number | null; lng: number | null; status: string; doNotContact: boolean; photos: string[];
  websiteRating: { label: string | null; score: number | null; summary: string | null } | null; opportunity: { score: number; summary: string | null } | null;
  contacts: { email: string; role: string | null; eligibility: string; sourceUrl: string | null }[];
  facts: { field: string; value: string; sourceUrl: string | null; verified: boolean }[]; estimates: { field: string; value: string }[]; sources: string[];
};

/** Dark OpenFreeMap style (no key) + our own 3D building layer. */
const STYLE = "https://tiles.openfreemap.org/styles/dark";
const PIN = { high: "#199e70", nosite: "#d95926", other: "#3987e5" } as const;
const PIN_LABEL = { high: "High opportunity", nosite: "No website", other: "Has a website" } as const;
type PinKind = keyof typeof PIN;
const kindOf = (p: Pick<Point, "score" | "websiteClass" | "website">): PinKind => ((p.score ?? 0) >= 70 ? "high" : p.websiteClass === "NO_WEBSITE" || (!p.website && p.websiteClass == null) ? "nosite" : "other");
const hasXY = (p: Point) => p.lat != null && p.lng != null;
const ACTIVE = ["QUEUED", "RUNNING"];

const STATUS: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "Waiting", cls: "bg-amber-400/15 text-amber-300 ring-amber-300/30" },
  RUNNING: { label: "Live", cls: "bg-emerald-400/15 text-emerald-300 ring-emerald-300/30" },
  PAUSED: { label: "Paused", cls: "bg-zinc-400/15 text-zinc-300 ring-zinc-300/30" },
  COMPLETED: { label: "Complete", cls: "bg-sky-400/15 text-sky-300 ring-sky-300/30" },
  FAILED: { label: "Failed", cls: "bg-red-400/15 text-red-300 ring-red-300/30" },
  CANCELLED: { label: "Cancelled", cls: "bg-zinc-400/15 text-zinc-300 ring-zinc-300/30" },
};

const EVENT_ICON: Record<string, { icon: typeof MapPin; cls: string }> = {
  BUSINESS_CREATED: { icon: MapPin, cls: "bg-emerald-400/15 text-emerald-300" },
  BUSINESS_DUPLICATE: { icon: Building2, cls: "bg-white/10 text-white/60" },
  BUSINESS_REJECTED: { icon: X, cls: "bg-amber-400/15 text-amber-300" },
  CONTACT_VERIFIED: { icon: Mail, cls: "bg-emerald-400/15 text-emerald-300" },
  CONTACT_REJECTED: { icon: Mail, cls: "bg-amber-400/15 text-amber-300" },
  FACTS_ADDED: { icon: Sparkles, cls: "bg-sky-400/15 text-sky-300" },
  DRAFT_CREATED: { icon: Mail, cls: "bg-violet-400/15 text-violet-300" },
  CLAIMED: { icon: Radio, cls: "bg-sky-400/15 text-sky-300" },
  CONTINUED: { icon: Radio, cls: "bg-sky-400/15 text-sky-300" },
  CLAUDE_CONNECTED: { icon: Radio, cls: "bg-sky-400/15 text-sky-300" },
  COMPANION_CONNECTED: { icon: Radio, cls: "bg-sky-400/15 text-sky-300" },
  AUDITS_QUEUED: { icon: Search, cls: "bg-white/10 text-white/60" },
  COMPLETED: { icon: CheckCircle2, cls: "bg-emerald-400/15 text-emerald-300" },
  PAUSED: { icon: Pause, cls: "bg-red-400/15 text-red-300" },
  CANCELLED: { icon: Ban, cls: "bg-red-400/15 text-red-300" },
  FAILED: { icon: Ban, cls: "bg-red-400/15 text-red-300" },
  ERROR: { icon: Ban, cls: "bg-red-400/15 text-red-300" },
};

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(q.matches);
    const on = () => setR(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return r;
}

const glass = "rounded-2xl border border-white/10 bg-[#0b1019]/85 shadow-2xl backdrop-blur-md";

/**
 * Full-screen live investigation: the map is the stage. New finds drop in with their name and
 * what they do, the camera flies to each one, notifications stream in, and clicking a business
 * opens everything WebScout knows about it.
 */
export function InvestigationView({ initial, canControl }: { initial: Live; canControl: boolean }) {
  const reduced = useReducedMotion();
  const [live, setLive] = useState(initial);
  const [intro, setIntro] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [spotlight, setSpotlight] = useState<Point | null>(null);
  const [follow, setFollow] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<"feed" | "list" | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const seen = useRef(new Set(initial.events.map((e) => e.id)));
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLElement }>());
  const known = useRef<Set<string> | null>(null);
  const pointsRef = useRef(live.points);
  const userMovedAt = useRef(0);
  const lastFindAt = useRef(0);
  const framed = useRef(false);
  const prevStatus = useRef(live.status);
  const tourIdx = useRef(0);
  const followRef = useRef(follow);
  const selectedRef = useRef(selected);
  pointsRef.current = live.points;
  followRef.current = follow;
  selectedRef.current = selected;
  const active = ACTIVE.includes(live.status);

  const pad = useCallback(() => (typeof window !== "undefined" && window.innerWidth >= 1024 ? { top: 170, bottom: 50, left: 370, right: 430 } : { top: 170, bottom: 220, left: 30, right: 30 }), []);

  // Full-window mode: no page scrolling underneath, Esc closes the details drawer.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), reduced ? 0 : 1600);
    return () => clearTimeout(t);
  }, [reduced]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live updates.
  useEffect(() => {
    if (!["QUEUED", "RUNNING", "PAUSED"].includes(live.status)) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const n = await apiFetch<Live>(`/api/live/${live.kind}/${live.id}`);
        if (!alive) return;
        const newIds = n.events.filter((e) => !seen.current.has(e.id)).map((e) => e.id);
        newIds.forEach((id) => seen.current.add(id));
        if (newIds.length) setFresh(new Set(newIds));
        setLive(n);
      } catch {
        /* keep the last state; try again next tick */
      }
    };
    const t = setInterval(tick, live.status === "PAUSED" ? 6000 : 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [live.kind, live.id, live.status]);

  // Map.
  useEffect(() => {
    let cancelled = false;
    const store = markers.current;
    import("maplibre-gl")
      .then((mod) => {
        if (cancelled || !box.current) return;
        lib.current = mod;
        const m = new mod.Map({ container: box.current, style: STYLE, center: [-40, 30], zoom: 1.4, attributionControl: { compact: true } });
        m.addControl(new mod.NavigationControl({ visualizePitch: true }), "bottom-right");
        m.on("load", () => {
          if (cancelled) return;
          try {
            const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
            m.addLayer({ id: "ws-3d-buildings", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14, paint: { "fill-extrusion-color": "#273041", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.88 } }, firstSymbol);
          } catch {
            /* 3D buildings are a nicety */
          }
          setReady(true);
        });
        m.on("movestart", (e: { originalEvent?: unknown }) => {
          if (e.originalEvent) userMovedAt.current = Date.now();
        });
        m.on("zoom", () => box.current?.classList.toggle("ws-far", m.getZoom() < 10.5));
        m.on("click", () => setSelected(null));
        map.current = m;
      })
      .catch(() => setMapError("Your browser couldn't start the map (WebGL is off or unsupported)."));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      store.clear();
    };
  }, []);

  const flyTo = useCallback(
    (p: Point, opts: { zoom?: number; pitch?: number; spin?: boolean } = {}) => {
      const m = map.current;
      if (!m || !hasXY(p)) return;
      m.flyTo({ center: [p.lng!, p.lat!], zoom: opts.zoom ?? 15.4, pitch: opts.pitch ?? 52, bearing: m.getBearing() + 18, duration: reduced ? 0 : 2300, essential: true, padding: pad() });
      if (opts.spin && !reduced) m.once("moveend", () => map.current?.rotateTo(m.getBearing() + 80, { duration: 16000, easing: (t) => t }));
    },
    [pad, reduced],
  );
  const fitAll = useCallback(
    (pts: Point[], duration = 2400) => {
      const m = map.current;
      const mod = lib.current;
      const xy = pts.filter(hasXY);
      if (!m || !mod || !xy.length) return false;
      if (xy.length === 1) {
        flyTo(xy[0]!, { zoom: 14 });
        return true;
      }
      const b = new mod.LngLatBounds();
      for (const p of xy) b.extend([p.lng!, p.lat!]);
      m.fitBounds(b, { padding: pad(), maxZoom: 14.5, duration: reduced ? 0 : duration, pitch: 35 });
      return true;
    },
    [flyTo, pad, reduced],
  );

  // First camera move once the intro is done: fly from the globe to the search area.
  useEffect(() => {
    if (!ready || intro || framed.current) return;
    framed.current = true;
    const m = map.current!;
    if (fitAll(pointsRef.current, 3200)) return;
    if (live.area?.bounds) m.fitBounds(live.area.bounds, { padding: pad(), maxZoom: 12.5, duration: reduced ? 0 : 3400 });
    else if (live.area?.center) m.flyTo({ center: live.area.center, zoom: 11, duration: reduced ? 0 : 3400 });
  }, [ready, intro, live.area, fitAll, pad, reduced]);

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      setMobilePanel(null);
      const p = id ? pointsRef.current.find((x) => x.id === id) : null;
      if (p) flyTo(p, { zoom: 16, pitch: 55 });
    },
    [flyTo],
  );

  // Pins: add new businesses (animated), keep labels in sync, follow new finds with the camera.
  useEffect(() => {
    const m = map.current;
    const mod = lib.current;
    if (!ready || !m || !mod) return;
    const pts = live.points.filter(hasXY);
    if (!known.current) known.current = new Set(pts.map((p) => p.id));
    const added: Point[] = [];
    const ids = new Set<string>();
    for (const p of pts) {
      ids.add(p.id);
      if (markers.current.has(p.id)) continue;
      const isNew = !known.current.has(p.id);
      const el = document.createElement("button");
      el.type = "button";
      el.className = cn("ws-marker ws-marker--live", isNew && "is-new");
      el.style.setProperty("--pin", PIN[kindOf(p)]);
      el.setAttribute("aria-label", `${p.name}${p.category ? `, ${p.category}` : ""}`);
      el.innerHTML = '<span class="ws-pulse"></span><span class="ws-pin"></span><span class="ws-label"><b></b><i></i></span>';
      el.querySelector("b")!.textContent = p.name;
      el.querySelector("i")!.textContent = [p.category, p.city].filter(Boolean).join(" · ");
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        select(p.id);
      });
      const marker = new mod.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lng!, p.lat!]).addTo(m);
      markers.current.set(p.id, { marker, el });
      if (isNew) {
        known.current.add(p.id);
        added.push(p);
        setTimeout(() => el.classList.remove("is-new"), 7000);
      }
    }
    for (const [id, { marker }] of markers.current) {
      if (!ids.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    if (added.length) {
      lastFindAt.current = Date.now();
      setSpotlight(added[added.length - 1]!);
      const following = followRef.current && !selectedRef.current && Date.now() - userMovedAt.current > 15000;
      if (following && framed.current) {
        if (added.length === 1) flyTo(added[0]!);
        else fitAll(added, 2000);
      }
    }
  }, [live.points, ready, select, flyTo, fitAll]);

  useEffect(() => {
    for (const [id, { el }] of markers.current) el.classList.toggle("is-selected", id === selected);
  }, [selected, live.points]);

  // While Claude works between finds, tour the businesses found so far.
  useEffect(() => {
    if (live.status !== "RUNNING" || reduced) return;
    const t = setInterval(() => {
      const pts = pointsRef.current.filter(hasXY);
      if (pts.length < 2 || !followRef.current || selectedRef.current) return;
      if (Date.now() - lastFindAt.current < 9000 || Date.now() - userMovedAt.current < 15000) return;
      const p = pts[tourIdx.current++ % pts.length]!;
      for (const [id, { el }] of markers.current) el.classList.toggle("is-tour", id === p.id);
      flyTo(p, { zoom: 15, pitch: 48 });
    }, 7000);
    return () => clearInterval(t);
  }, [live.status, reduced, flyTo]);

  // When the investigation finishes, pull back to show everything that was found.
  useEffect(() => {
    if (prevStatus.current !== live.status && ["COMPLETED", "CANCELLED", "FAILED"].includes(live.status)) {
      for (const [, { el }] of markers.current) el.classList.remove("is-tour");
      fitAll(pointsRef.current, 2600);
    }
    prevStatus.current = live.status;
  }, [live.status, fitAll]);

  useEffect(() => {
    if (!spotlight) return;
    const t = setTimeout(() => setSpotlight(null), 5500);
    return () => clearTimeout(t);
  }, [spotlight]);

  useEffect(() => {
    if (!selected) {
      setProfile(null);
      return;
    }
    let alive = true;
    setProfile(null);
    apiFetch<Profile>(`/api/leads/${selected}/profile`).then((p) => alive && setProfile(p), () => {});
    return () => {
      alive = false;
    };
  }, [selected]);

  async function control(action: "pause" | "resume" | "cancel") {
    setBusy(action);
    try {
      setLive(await apiFetch<Live>(`/api/live/${live.kind}/${live.id}`, { body: { action } }));
    } catch {
      /* the next poll shows the real state */
    } finally {
      setBusy(null);
    }
  }

  const st = STATUS[live.status] ?? { label: live.status, cls: "bg-white/10 text-white ring-white/20" };
  const elapsed = clock((live.finishedAt ? new Date(live.finishedAt).getTime() : now) - new Date(live.startedAt ?? live.createdAt).getTime());
  const listed = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...live.points].sort((a, b) => +new Date(b.discoveredAt) - +new Date(a.discoveredAt));
    return q ? sorted.filter((p) => `${p.name} ${p.category ?? ""} ${p.city ?? ""}`.toLowerCase().includes(q)) : sorted;
  }, [live.points, filter]);
  const kinds = (Object.keys(PIN) as PinKind[]).filter((k) => live.points.some((p) => kindOf(p) === k));
  const waitingForClaude = live.kind === "claude" && live.status === "QUEUED";
  const finished = ["COMPLETED", "CANCELLED", "FAILED"].includes(live.status);

  const feed = (
    <ul className="space-y-1.5">
      {live.events.slice(0, 120).map((e) => {
        const I = EVENT_ICON[e.type] ?? { icon: ChevronRight, cls: "bg-white/10 text-white/60" };
        const Icon = I.icon;
        return (
          <li key={e.id} className={cn(fresh.has(e.id) && "ws-feed-new")}>
            <button type="button" disabled={!e.businessId} onClick={() => e.businessId && select(e.businessId)} className={cn("flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] leading-5", e.businessId ? "hover:bg-white/5" : "cursor-default")}>
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", I.cls)}><Icon className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1 text-white/85">{e.message}</span>
              <span className="shrink-0 text-[11px] text-white/40">{ago(e.createdAt, now)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const list = (
    <ul className="space-y-1">
      {listed.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => select(p.id)} className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5", selected === p.id && "bg-white/10")}>
            {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-lg object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold" style={{ background: `${PIN[kindOf(p)]}33`, color: PIN[kindOf(p)] }}>{p.name.slice(0, 1).toUpperCase()}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{p.name}</span>
              <span className="block truncate text-[11.5px] text-white/55">{p.summary ?? ([p.category, p.city].filter(Boolean).join(" · ") || "Business")}</span>
            </span>
            {p.score != null && <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] tabular-nums text-white/70">{p.score}</span>}
          </button>
        </li>
      ))}
      {!listed.length && <li className="px-2 py-6 text-center text-[13px] text-white/45">{live.points.length ? "No matches." : active ? "Businesses appear here as they're found." : "No businesses found."}</li>}
    </ul>
  );

  return (
    <div className="ws-live fixed inset-0 z-[60] overflow-hidden bg-[#06080c] text-white" role="dialog" aria-modal="true" aria-label={`Live view: ${live.title}`}>
      {/* z-index 0 keeps map pins/labels inside the map layer, under the panels */}
      <div ref={box} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      {mapError && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70">{mapError}</div>}
      {active && !live.points.length && (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center opacity-70">
          <div className="ws-radar"><div className="ws-radar-ring" /></div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-48 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />

      {/* HUD */}
      <div className={cn(glass, "absolute inset-x-3 top-3 z-10 px-4 py-3")}>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={live.backHref} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10" aria-label="Exit live view"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{live.kind === "claude" ? "Claude investigation" : "Business search"}<span className="hidden sm:inline"> · #{live.shortId}</span></span>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", st.cls)}>{live.status === "RUNNING" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />}{st.label}</span>
            </div>
            <h1 className="truncate text-base font-semibold sm:text-lg">{live.title}</h1>
          </div>
          <div className="hidden text-right sm:block">
            <div className="font-mono text-lg tabular-nums leading-6">{elapsed}</div>
            <div className="text-[11px] text-white/45">elapsed</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setFollow((f) => !f)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium", follow ? "bg-sky-400/15 text-sky-200" : "bg-white/5 text-white/60 hover:bg-white/10")} aria-pressed={follow} title="Move the map to each new find">
              <LocateFixed className="h-4 w-4" /> <span className="hidden md:inline">{follow ? "Following" : "Follow finds"}</span>
            </button>
            {canControl && live.controls.pause && <button type="button" onClick={() => control("pause")} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/5 px-3 text-[12.5px] font-medium hover:bg-white/10"><Pause className="h-4 w-4" /> <span className="hidden md:inline">Pause</span></button>}
            {canControl && live.controls.resume && <button type="button" onClick={() => control("resume")} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-400/20 px-3 text-[12.5px] font-medium text-emerald-200 hover:bg-emerald-400/30"><Play className="h-4 w-4" /> Resume</button>}
            {canControl && live.controls.cancel && <button type="button" onClick={() => control("cancel")} disabled={busy !== null} className="hidden h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium text-white/60 hover:bg-white/10 hover:text-red-300 sm:inline-flex"><Ban className="h-4 w-4" /> Stop</button>}
            <Link href={live.backHref} className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/10" aria-label="Close live view"><X className="h-4 w-4" /></Link>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-[width] duration-700" style={{ width: `${Math.max(live.status === "RUNNING" ? 3 : 0, live.progress)}%` }} /></div>
          <span className="w-10 text-right text-[11px] tabular-nums text-white/50">{live.progress}%</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {live.stats.map((s) => (
            <div key={s.key} className="flex items-baseline gap-1.5">
              <span key={s.value} className="ws-pop inline-block text-base font-semibold tabular-nums">{s.value.toLocaleString("en-US")}</span>
              <span className="text-[11.5px] text-white/50">{s.label}</span>
            </div>
          ))}
          {live.message && <span className="ml-auto hidden max-w-[45%] truncate text-[12px] text-white/55 md:block">{live.message}</span>}
        </div>
      </div>

      {/* Found businesses (desktop) */}
      <aside className={cn(glass, "absolute bottom-3 left-3 top-[178px] z-10 hidden w-[340px] flex-col lg:flex")} aria-label="Businesses found">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <div className="text-sm font-semibold">Businesses found <span className="text-white/45">({live.points.length})</span></div>
        </div>
        <div className="px-3 pb-2"><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or type…" className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-[13px] text-white placeholder:text-white/35 focus:border-sky-400/50 focus:outline-none" /></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">{list}</div>
        {kinds.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 px-4 py-2.5 text-[11px] text-white/60">{kinds.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: PIN[k] }} />{PIN_LABEL[k]}</span>)}</div>}
      </aside>

      {/* Live feed or business details (desktop) */}
      <aside className={cn(glass, "absolute bottom-3 right-3 top-[178px] z-10 hidden w-[400px] flex-col overflow-hidden lg:flex")} aria-label={selected ? "Business details" : "Live activity"}>
        {selected ? <Details profile={profile} point={live.points.find((p) => p.id === selected) ?? null} onClose={() => setSelected(null)} on3d={() => { const p = live.points.find((x) => x.id === selected); if (p) flyTo(p, { zoom: 17.2, pitch: 64, spin: true }); }} /> : (
          <>
            <div className="flex items-center justify-between px-4 pb-2 pt-3"><div className="flex items-center gap-2 text-sm font-semibold">{active && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}Live activity</div><span className="text-[11px] text-white/40">{live.events.length} updates</span></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">{feed}</div>
          </>
        )}
      </aside>

      {/* New-find spotlight */}
      {spotlight && !selected && (
        <button type="button" onClick={() => select(spotlight.id)} className={cn(glass, "ws-slide-up absolute left-1/2 top-[190px] z-20 flex w-[min(420px,calc(100%-24px))] -translate-x-1/2 items-center gap-3 px-4 py-3 text-left")}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${PIN[kindOf(spotlight)]}2e`, color: PIN[kindOf(spotlight)] }}><MapPin className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-300">New business found</span>
            <span className="block truncate font-semibold">{spotlight.name}</span>
            <span className="block truncate text-[12px] text-white/60">{spotlight.summary ?? [spotlight.category, spotlight.city].filter(Boolean).join(" · ")}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-white/40" />
        </button>
      )}

      {/* Waiting for Claude */}
      {waitingForClaude && !intro && (
        <div className={cn(glass, "ws-slide-up absolute left-1/2 top-1/2 z-10 w-[min(460px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 p-6 text-center")}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300"><Radio className="h-6 w-6 animate-pulse" /></div>
          <h2 className="mt-3 text-lg font-semibold">Waiting for Claude</h2>
          <p className="mt-1 text-sm text-white/60">Open Claude (Desktop or claude.ai) with the WebScout AI connector switched on, and say:</p>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5">
            <code className="flex-1 text-left font-mono text-sm text-sky-200">{live.say}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(live.say ?? "").catch(() => {})} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-medium hover:bg-white/15"><Copy className="h-3.5 w-3.5" /> Copy</button>
          </div>
          <p className="mt-3 text-[12px] text-white/45">This screen comes alive the moment Claude starts — keep it open.</p>
        </div>
      )}

      {/* Finished */}
      {finished && !selected && (
        <div className={cn(glass, "ws-slide-up absolute bottom-6 left-1/2 z-10 w-[min(520px,calc(100%-24px))] -translate-x-1/2 p-5 lg:bottom-auto lg:top-[190px]")}>
          <div className="flex items-start gap-3">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", live.status === "COMPLETED" ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300")}>{live.status === "COMPLETED" ? <CheckCircle2 className="h-5 w-5" /> : <Ban className="h-5 w-5" />}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{live.status === "COMPLETED" ? (live.kind === "claude" ? "Investigation complete" : "Search complete") : live.status === "FAILED" ? "Stopped with a problem" : "Stopped"}</div>
              <p className="mt-0.5 text-sm text-white/65">{live.summary ?? live.error ?? `${live.points.length} businesses on the map.`}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/leads?sort=newest" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black hover:bg-white/90"><List className="h-3.5 w-3.5" /> See the leads</Link>
                <Link href={live.detailsHref} className="inline-flex h-8 items-center rounded-lg bg-white/10 px-3 text-xs font-medium hover:bg-white/15">Details</Link>
                <Link href={live.backHref} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-white/70 hover:bg-white/10">Close</Link>
              </div>
            </div>
          </div>
        </div>
      )}
      {live.status === "PAUSED" && (
        <div className={cn(glass, "absolute left-1/2 top-[190px] z-10 flex -translate-x-1/2 items-center gap-3 px-4 py-2.5 text-sm")}>
          <Pause className="h-4 w-4 text-amber-300" /> Paused — nothing more is saved until you resume.
          {canControl && <button type="button" onClick={() => control("resume")} className="rounded-lg bg-emerald-400/20 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/30">Resume</button>}
        </div>
      )}

      {/* Mobile: bottom sheet */}
      <div className="absolute inset-x-3 bottom-3 z-10 lg:hidden">
        {selected ? (
          <div className={cn(glass, "max-h-[62vh] overflow-y-auto")}><Details profile={profile} point={live.points.find((p) => p.id === selected) ?? null} onClose={() => setSelected(null)} on3d={() => { const p = live.points.find((x) => x.id === selected); if (p) flyTo(p, { zoom: 17.2, pitch: 64, spin: true }); }} /></div>
        ) : mobilePanel ? (
          <div className={cn(glass, "flex max-h-[48vh] flex-col")}>
            <div className="flex items-center justify-between px-4 pb-1 pt-3"><div className="text-sm font-semibold">{mobilePanel === "feed" ? "Live activity" : `Businesses found (${live.points.length})`}</div><button type="button" onClick={() => setMobilePanel(null)} aria-label="Close" className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{mobilePanel === "feed" ? feed : list}</div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setMobilePanel("feed")} className={cn(glass, "flex-1 px-3 py-2.5 text-left text-[13px]")}><span className="block text-[11px] text-white/45">Latest</span><span className="block truncate">{live.events[0]?.message ?? "Waiting…"}</span></button>
            <button type="button" onClick={() => setMobilePanel("list")} className={cn(glass, "px-4 text-[13px] font-semibold")}>{live.points.length}<span className="block text-[10.5px] font-normal text-white/45">found</span></button>
          </div>
        )}
      </div>

      {/* Intro */}
      <div className={cn("absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#06080c] transition-opacity duration-700", intro ? "opacity-100" : "pointer-events-none opacity-0")} aria-hidden={!intro}>
        <div className="relative flex items-center justify-center"><div className="ws-radar" style={{ width: 220 }}><div className="ws-radar-ring" /></div><Search className="absolute h-8 w-8 text-sky-300" /></div>
        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300/80">{live.kind === "claude" ? "Starting investigation" : "Starting search"}</div>
        <div className="mt-2 max-w-[80vw] truncate text-xl font-semibold">{live.title}</div>
      </div>
    </div>
  );
}

function Details({ profile, point, onClose, on3d }: { profile: Profile | null; point: Point | null; onClose: () => void; on3d: () => void }) {
  const name = profile?.name ?? point?.name ?? "";
  const photo = profile?.photos[0] ?? point?.imageUrl ?? null;
  const k = point ? kindOf(point) : "other";
  return (
    <div className="ws-slide-up flex min-h-0 flex-1 flex-col">
      <div className="relative h-36 shrink-0 overflow-hidden" style={{ background: `linear-gradient(135deg, ${PIN[k]}55, #0b1019)` }}>
        {photo && <img src={photo} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-90" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b1019] via-transparent to-transparent" />
        <button type="button" onClick={onClose} aria-label="Close details" className="absolute right-3 top-3 rounded-lg bg-black/50 p-1.5 hover:bg-black/70"><X className="h-4 w-4" /></button>
        <div className="absolute bottom-2 left-4 right-4">
          <div className="truncate text-lg font-semibold">{name}</div>
          <div className="truncate text-[12px] text-white/65">{[profile?.category ?? point?.category, profile?.city ?? point?.city].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px] scrollbar-thin">
        {!profile ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-white/10" style={{ width: `${90 - i * 18}%` }} />)}</div> : (
          <>
            <section>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">What they do</h3>
              <p className="leading-5 text-white/85">{profile.whatTheyDo ?? (profile.category ? `${profile.category}${profile.city ? ` in ${profile.city}` : ""}.` : "Not described yet — run a website audit or ask Claude to research it.")}</p>
              {profile.services && <p className="mt-1.5 text-[12px] text-white/55">Services: {profile.services}</p>}
            </section>
            <dl className="space-y-1.5">
              {profile.address && <div className="flex gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" /><dd>{profile.address}</dd></div>}
              {profile.phone && <div className="flex gap-2"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" /><dd><a href={`tel:${profile.phone}`} className="text-sky-300 hover:underline">{profile.phone}</a></dd></div>}
              <div className="flex gap-2"><Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" /><dd>{profile.website ? <a href={profile.website} target="_blank" rel="noreferrer noopener" className="text-sky-300 hover:underline">{host(profile.website)}</a> : <span className="text-amber-300">No website found</span>}</dd></div>
              {profile.email && <div className="flex gap-2"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" /><dd>{profile.email}</dd></div>}
              {profile.rating != null && <div className="flex gap-2"><Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /><dd>{profile.rating.toFixed(1)}{profile.reviews ? ` from ${profile.reviews} reviews` : ""}</dd></div>}
            </dl>
            {(profile.websiteRating || profile.opportunity) && (
              <section className="grid grid-cols-2 gap-2">
                {profile.websiteRating && <div className="rounded-xl bg-white/5 p-2.5"><div className="text-[11px] text-white/45">Website</div><div className="font-semibold capitalize">{profile.websiteRating.label ?? "—"}</div>{profile.websiteRating.score != null && <div className="text-[11px] text-white/50">score {profile.websiteRating.score}/100</div>}</div>}
                {profile.opportunity && <div className="rounded-xl bg-white/5 p-2.5"><div className="text-[11px] text-white/45">Opportunity</div><div className="font-semibold">{profile.opportunity.score}/100</div>{profile.opportunity.summary && <div className="line-clamp-2 text-[11px] text-white/50">{profile.opportunity.summary}</div>}</div>}
              </section>
            )}
            {profile.contacts.length > 0 && (
              <section>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">Contacts</h3>
                <ul className="space-y-1">{profile.contacts.slice(0, 4).map((c) => <li key={c.email} className="flex items-center justify-between gap-2"><span className="truncate">{c.email}</span><span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", c.eligibility === "ELIGIBLE" ? "bg-emerald-400/15 text-emerald-300" : c.eligibility === "INELIGIBLE" ? "bg-red-400/15 text-red-300" : "bg-amber-400/15 text-amber-300")}>{c.eligibility === "ELIGIBLE" ? "OK to email" : c.eligibility === "INELIGIBLE" ? "Don't email" : "Needs review"}</span></li>)}</ul>
              </section>
            )}
            {(profile.facts.length > 0 || profile.estimates.length > 0) && (
              <section>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">Research</h3>
                <ul className="space-y-1.5">
                  {profile.facts.map((f, i) => <li key={`f${i}`}><span className="text-white/55">{f.field.replace(/_/g, " ")}:</span> {f.value}{f.verified && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-300" aria-label="found on the source page" />}{f.sourceUrl && <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener" className="ml-1 text-[11px] text-sky-300 hover:underline">{host(f.sourceUrl)}</a>}</li>)}
                  {profile.estimates.map((f, i) => <li key={`e${i}`}><span className="text-white/55">{f.field.replace(/_/g, " ")}:</span> {f.value} <span className="rounded bg-white/10 px-1 text-[10px] text-white/55">estimate</span></li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-white/10 p-3">
        <button type="button" onClick={on3d} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[12.5px] font-medium hover:bg-white/15"><Box className="h-4 w-4" /> 3D view</button>
        {point && <Link href={`/leads/${point.id}?tab=pitch`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[12.5px] font-medium hover:bg-white/15"><Mail className="h-4 w-4" /> Quote</Link>}
        {point && <Link href={`/leads/${point.id}`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white text-[12.5px] font-semibold text-black hover:bg-white/90"><ExternalLink className="h-4 w-4" /> Open lead</Link>}
      </div>
    </div>
  );
}
