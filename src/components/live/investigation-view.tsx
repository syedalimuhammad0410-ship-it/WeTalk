"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeft, Ban, Box, Building2, CheckCircle2, ChevronRight, Clock, Copy, ExternalLink, Globe, Lightbulb, List, LocateFixed, Mail, MapPin, Pause, Phone, Play, Radio, Search, Sparkles, Star, Wrench, X } from "lucide-react";
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
  email: string | null; rating: number | null; reviews: number | null; lat: number | null; lng: number | null; status: string; doNotContact: boolean; photos: string[]; source: string;
  websiteRating: { label: string | null; score: number | null; summary: string | null } | null; opportunity: { score: number; summary: string | null } | null;
  contacts: { email: string; role: string | null; eligibility: string; sourceUrl: string | null }[]; hours: string[]; social: { label: string; url: string }[];
  reasons: { label: string; verified: boolean }[]; missing: string[];
  facts: { field: string; value: string; sourceUrl: string | null; verified: boolean }[]; estimates: { field: string; value: string }[]; sources: string[]; discoveredAt: string;
};

type PinKind = "high" | "nosite" | "other";
const PIN_LABEL: Record<PinKind, string> = { high: "High opportunity", nosite: "No website", other: "Has a website" };
const kindOf = (p: Pick<Point, "score" | "websiteClass" | "website">): PinKind => ((p.score ?? 0) >= 70 ? "high" : p.websiteClass === "NO_WEBSITE" || (!p.website && p.websiteClass == null) ? "nosite" : "other");
const SITE_LABEL: Record<string, string> = { NO_WEBSITE: "No website", OUTDATED: "Outdated website", BROKEN: "Broken website", MODERN: "Modern website", SOCIAL_ONLY: "Social page only" };
const siteLabel = (p: Pick<Point, "websiteClass" | "website">) => (p.websiteClass && SITE_LABEL[p.websiteClass]) || (p.website ? "Has a website" : "No website found");
const hasXY = (p: Point) => p.lat != null && p.lng != null;
const ACTIVE = ["QUEUED", "RUNNING"];
const EMPTY = { type: "FeatureCollection" as const, features: [] };
const DASH = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const STATUS: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "Waiting for Claude", cls: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300" },
  RUNNING: { label: "Live", cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300" },
  PAUSED: { label: "Paused", cls: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300" },
  COMPLETED: { label: "Complete", cls: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300" },
  FAILED: { label: "Failed", cls: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300" },
  CANCELLED: { label: "Stopped", cls: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300" },
};
const EVENT_ICON: Record<string, { icon: typeof MapPin; cls: string }> = {
  BUSINESS_CREATED: { icon: MapPin, cls: "bg-emerald-500/10 text-emerald-600" },
  BUSINESS_DUPLICATE: { icon: Building2, cls: "bg-subtle text-muted" },
  BUSINESS_REJECTED: { icon: X, cls: "bg-amber-500/10 text-amber-600" },
  CONTACT_VERIFIED: { icon: Mail, cls: "bg-emerald-500/10 text-emerald-600" },
  CONTACT_REJECTED: { icon: Mail, cls: "bg-amber-500/10 text-amber-600" },
  FACTS_ADDED: { icon: Sparkles, cls: "bg-accent/10 text-accent" },
  DRAFT_CREATED: { icon: Mail, cls: "bg-violet-500/10 text-violet-600" },
  CLAIMED: { icon: Radio, cls: "bg-accent/10 text-accent" },
  CONTINUED: { icon: Radio, cls: "bg-accent/10 text-accent" },
  CLAUDE_CONNECTED: { icon: Radio, cls: "bg-accent/10 text-accent" },
  COMPANION_CONNECTED: { icon: Radio, cls: "bg-accent/10 text-accent" },
  AUDITS_QUEUED: { icon: Search, cls: "bg-subtle text-muted" },
  COMPLETED: { icon: CheckCircle2, cls: "bg-emerald-500/10 text-emerald-600" },
  PAUSED: { icon: Pause, cls: "bg-red-500/10 text-red-600" },
  CANCELLED: { icon: Ban, cls: "bg-red-500/10 text-red-600" },
  FAILED: { icon: Ban, cls: "bg-red-500/10 text-red-600" },
  ERROR: { icon: Ban, cls: "bg-red-500/10 text-red-600" },
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

/** Colours from the app's theme tokens, so the map matches light or dark mode. */
function readTheme() {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const color = (name: string, fallback: string) => {
    const v = css.getPropertyValue(name).trim();
    return !v ? fallback : v.startsWith("#") ? v : `rgb(${v.split(/[\s,]+/).filter(Boolean).slice(0, 3).join(",")})`;
  };
  const dark = root.dataset.theme === "dark";
  return {
    dark,
    accent: color("--accent", "rgb(79,70,229)"),
    surface: color("--surface", "rgb(255,255,255)"),
    pins: { high: color("--series-3", "#1baf7a"), nosite: color("--series-2", "#eb6834"), other: color("--series-1", "#2a78d6") } as Record<PinKind, string>,
    style: dark ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/positron",
    buildings: dark ? "#273041" : "#dedcd6",
  };
}

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

const panel = "rounded-2xl border border-border bg-surface/95 shadow-xl shadow-black/[0.06] backdrop-blur-md";

/**
 * Full-screen live investigation in the app's own style. The map is the stage: a pulsing hub marks
 * the search area, connection lines run out to every business with dots flowing along them, new
 * finds drop in with their name and what they do, and clicking one opens everything we know.
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
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pins, setPins] = useState<Record<PinKind, string>>({ high: "#1baf7a", nosite: "#eb6834", other: "#2a78d6" });
  const seen = useRef(new Set(initial.events.map((e) => e.id)));
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const theme = useRef<ReturnType<typeof readTheme> | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLElement }>());
  const hubMarker = useRef<Marker | null>(null);
  const known = useRef<Set<string> | null>(null);
  const packets = useRef<{ from: [number, number]; to: [number, number]; start: number; dur: number }[]>([]);
  const pointsRef = useRef(live.points);
  const hubRef = useRef<[number, number] | null>(null);
  const activeRef = useRef(false);
  const userMovedAt = useRef(0);
  const lastFindAt = useRef(0);
  const framed = useRef(false);
  const prevStatus = useRef(live.status);
  const tourIdx = useRef(0);
  const followRef = useRef(follow);
  const selectedRef = useRef(selected);
  const active = ACTIVE.includes(live.status);
  pointsRef.current = live.points;
  followRef.current = follow;
  selectedRef.current = selected;
  activeRef.current = live.status === "RUNNING";

  // The hub: the search area's centre, or the middle of what's been found.
  const hub = useMemo<[number, number] | null>(() => {
    if (live.area?.center) return live.area.center;
    const xy = live.points.filter(hasXY);
    if (!xy.length) return null;
    return [xy.reduce((s, p) => s + p.lng!, 0) / xy.length, xy.reduce((s, p) => s + p.lat!, 0) / xy.length];
  }, [live.area, live.points]);
  hubRef.current = hub;

  const pad = useCallback(() => (typeof window !== "undefined" && window.innerWidth >= 1024 ? { top: 170, bottom: 50, left: 370, right: 430 } : { top: 180, bottom: 220, left: 30, right: 30 }), []);

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
    const t = setTimeout(() => setIntro(false), reduced ? 0 : 1500);
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

  // Map with 3D buildings, connection lines and flowing dots.
  useEffect(() => {
    let cancelled = false;
    const store = markers.current;
    const th = readTheme();
    theme.current = th;
    setPins(th.pins);
    import("maplibre-gl")
      .then((mod) => {
        if (cancelled || !box.current) return;
        lib.current = mod;
        const m = new mod.Map({ container: box.current, style: th.style, center: [-40, 30], zoom: 1.4, attributionControl: { compact: true } });
        m.addControl(new mod.NavigationControl({ visualizePitch: true }), "bottom-right");
        m.on("load", () => {
          if (cancelled) return;
          const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
          try {
            m.addLayer({ id: "ws-3d-buildings", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14, paint: { "fill-extrusion-color": th.buildings, "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.9 } }, firstSymbol);
          } catch {
            /* 3D buildings are a nicety */
          }
          m.addSource("ws-links", { type: "geojson", data: EMPTY });
          m.addLayer({ id: "ws-links-glow", type: "line", source: "ws-links", layout: { "line-cap": "round" }, paint: { "line-color": th.accent, "line-width": 6, "line-opacity": 0.1, "line-blur": 3 } }, firstSymbol);
          m.addLayer({ id: "ws-links-flow", type: "line", source: "ws-links", layout: { "line-cap": "round" }, paint: { "line-color": th.accent, "line-width": 1.6, "line-opacity": 0.55, "line-dasharray": [0, 4, 3] } }, firstSymbol);
          m.addSource("ws-packets", { type: "geojson", data: EMPTY });
          m.addLayer({ id: "ws-packets", type: "circle", source: "ws-packets", paint: { "circle-radius": 4.2, "circle-color": th.accent, "circle-stroke-color": th.surface, "circle-stroke-width": 1.6 } });
          setReady(true);
        });
        m.on("error", () => {
          /* tile hiccups are retried by the map */
        });
        m.on("movestart", (e: { originalEvent?: unknown }) => {
          if (e.originalEvent) userMovedAt.current = Date.now();
        });
        m.on("zoom", () => box.current?.classList.toggle("ws-far", m.getZoom() < 10.5));
        m.on("moveend", () => updateDensity());
        m.on("click", () => setSelected(null));
        map.current = m;
      })
      .catch(() => setMapError("Your browser couldn't start the map (WebGL is off or unsupported)."));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      hubMarker.current = null;
      store.clear();
    };
  }, []);

  /** Crowded views keep only the newest, selected, toured or hovered labels visible. */
  function updateDensity() {
    const m = map.current;
    if (!m || !box.current) return;
    const b = m.getBounds();
    let n = 0;
    for (const p of pointsRef.current) if (hasXY(p) && b.contains([p.lng!, p.lat!])) n++;
    box.current.classList.toggle("ws-dense", n > 24);
  }

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
      if (hubRef.current) b.extend(hubRef.current);
      m.fitBounds(b, { padding: pad(), maxZoom: 14.5, duration: reduced ? 0 : duration, pitch: 35 });
      return true;
    },
    [flyTo, pad, reduced],
  );

  // First camera move once the intro is done: from the globe to the search area.
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

  // Hub marker at the search centre.
  useEffect(() => {
    const m = map.current;
    const mod = lib.current;
    if (!ready || !m || !mod || !hub) return;
    if (!hubMarker.current) {
      const el = document.createElement("div");
      el.className = "ws-hub";
      el.innerHTML = '<span class="ring"></span><span class="ring r2"></span><span class="core"></span><b></b>';
      el.querySelector("b")!.textContent = live.kind === "claude" ? "Claude" : "Search area";
      hubMarker.current = new mod.Marker({ element: el, anchor: "center" }).setLngLat(hub).addTo(m);
    } else hubMarker.current.setLngLat(hub);
  }, [ready, hub, live.kind]);

  // Pins + connection lines: add new businesses (animated), follow new finds with the camera.
  useEffect(() => {
    const m = map.current;
    const mod = lib.current;
    if (!ready || !m || !mod) return;
    const colors = theme.current?.pins ?? pins;
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
      el.style.setProperty("--pin", colors[kindOf(p)]);
      el.setAttribute("aria-label", `${p.name}${p.category ? `, ${p.category}` : ""}`);
      el.innerHTML = '<span class="ws-pulse"></span><span class="ws-pin"></span><span class="ws-label"><b></b><i></i><em></em><em></em></span>';
      el.querySelector("b")!.textContent = p.name;
      el.querySelector("i")!.textContent = p.summary ?? ([p.category, p.city].filter(Boolean).join(" · ") || "Business");
      const extra = el.querySelectorAll("em");
      extra[0]!.textContent = [p.rating != null ? `★ ${p.rating.toFixed(1)}${p.reviews ? ` (${p.reviews})` : ""}` : null, siteLabel(p), p.score != null ? `Score ${p.score}` : null].filter(Boolean).join(" · ");
      extra[1]!.textContent = p.address ?? [p.category, p.city].filter(Boolean).join(" · ");
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        select(p.id);
      });
      const marker = new mod.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lng!, p.lat!]).addTo(m);
      markers.current.set(p.id, { marker, el });
      if (isNew) {
        known.current.add(p.id);
        added.push(p);
        setTimeout(() => el.classList.remove("is-new", "show-label"), 7000);
      }
    }
    for (const [id, { marker }] of markers.current) {
      if (!ids.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    const h = hubRef.current;
    const links = m.getSource("ws-links") as GeoJSONSource | undefined;
    links?.setData({ type: "FeatureCollection", features: h ? pts.map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [h, [p.lng!, p.lat!]] } })) : [] });
    for (const p of added.slice(-3)) markers.current.get(p.id)?.el.classList.add("show-label");
    updateDensity();
    if (added.length) {
      lastFindAt.current = Date.now();
      const t = performance.now();
      if (h) for (const p of added) packets.current.push({ from: h, to: [p.lng!, p.lat!], start: t, dur: 1500 });
      setSpotlight(added[added.length - 1]!);
      setRecent(new Set(added.map((p) => p.id)));
      const following = followRef.current && !selectedRef.current && Date.now() - userMovedAt.current > 15000;
      if (following && framed.current) {
        if (added.length === 1) flyTo(added[0]!);
        else fitAll(added, 2000);
      }
    }
  }, [live.points, ready, select, flyTo, fitAll, pins]);

  // Animation loop: marching connection lines and dots flowing from the hub to businesses.
  useEffect(() => {
    if (!ready || reduced) return;
    let raf = 0;
    let lastDash = 0;
    let lastDraw = 0;
    let lastSpawn = 0;
    let step = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const m = map.current;
      const src = m?.getSource("ws-packets") as GeoJSONSource | undefined;
      if (!m || !src) return;
      const moving = activeRef.current || packets.current.length > 0;
      if (moving && t - lastDash > 70 && m.getLayer("ws-links-flow")) {
        lastDash = t;
        step = (step + 1) % DASH.length;
        m.setPaintProperty("ws-links-flow", "line-dasharray", DASH[step]);
      }
      if (activeRef.current && t - lastSpawn > 1100 && hubRef.current) {
        lastSpawn = t;
        const pts = pointsRef.current.filter(hasXY);
        if (pts.length) {
          const p = pts[Math.floor(Math.random() * pts.length)]!;
          packets.current.push({ from: hubRef.current, to: [p.lng!, p.lat!], start: t, dur: 2200 });
        }
      }
      if (t - lastDraw < 33) return;
      lastDraw = t;
      packets.current = packets.current.filter((p) => t - p.start < p.dur).slice(-40);
      src.setData({
        type: "FeatureCollection",
        features: packets.current.map((p) => {
          const k = ease(Math.min(1, (t - p.start) / p.dur));
          return { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [p.from[0] + (p.to[0] - p.from[0]) * k, p.from[1] + (p.to[1] - p.from[1]) * k] } };
        }),
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready, reduced]);

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

  // When it finishes, pull back to show everything that was found.
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

  const st = STATUS[live.status] ?? { label: live.status, cls: "bg-subtle text-muted ring-border" };
  const elapsed = clock((live.finishedAt ? new Date(live.finishedAt).getTime() : now) - new Date(live.startedAt ?? live.createdAt).getTime());
  const listed = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...live.points].sort((a, b) => +new Date(b.discoveredAt) - +new Date(a.discoveredAt));
    return q ? sorted.filter((p) => `${p.name} ${p.category ?? ""} ${p.city ?? ""} ${p.summary ?? ""}`.toLowerCase().includes(q)) : sorted;
  }, [live.points, filter]);
  const kinds = (Object.keys(PIN_LABEL) as PinKind[]).filter((k) => live.points.some((p) => kindOf(p) === k));
  const waitingForClaude = live.kind === "claude" && live.status === "QUEUED";
  const finished = ["COMPLETED", "CANCELLED", "FAILED"].includes(live.status);
  const selectedPoint = live.points.find((p) => p.id === selected) ?? null;
  const on3d = () => selectedPoint && flyTo(selectedPoint, { zoom: 17.2, pitch: 64, spin: true });

  const feed = (
    <ul className="space-y-1">
      {live.events.slice(0, 120).map((e) => {
        const I = EVENT_ICON[e.type] ?? { icon: ChevronRight, cls: "bg-subtle text-muted" };
        const Icon = I.icon;
        return (
          <li key={e.id} className={cn(fresh.has(e.id) && "ws-feed-new")}>
            <button type="button" disabled={!e.businessId} onClick={() => e.businessId && select(e.businessId)} className={cn("flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] leading-5", e.businessId ? "hover:bg-subtle" : "cursor-default")}>
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", I.cls)}><Icon className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1 text-fg/90">{e.message}</span>
              <span className="shrink-0 text-[11px] text-faint" suppressHydrationWarning>{ago(e.createdAt, now)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const list = (
    <ul className="space-y-1">
      {listed.map((p) => {
        const k = kindOf(p);
        return (
          <li key={p.id} className={cn("rounded-xl", recent.has(p.id) && "ws-flash")}>
            <button type="button" onClick={() => select(p.id)} className={cn("flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-subtle", selected === p.id && "bg-subtle ring-1 ring-border")}>
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold" style={{ background: `color-mix(in srgb, ${pins[k]} 14%, transparent)`, color: pins[k] }}>{p.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                <span className="block truncate text-[12px] text-muted">{p.summary ?? ([p.category, p.city].filter(Boolean).join(" · ") || "Business")}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                  <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium" style={{ background: `color-mix(in srgb, ${pins[k]} 12%, transparent)`, color: pins[k] }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: pins[k] }} />{siteLabel(p)}</span>
                  {p.rating != null && <span className="inline-flex items-center gap-0.5 rounded-md bg-subtle px-1.5 py-0.5 text-muted"><Star className="h-3 w-3 text-amber-500" />{p.rating.toFixed(1)}</span>}
                  {p.score != null && <span className="rounded-md bg-subtle px-1.5 py-0.5 tabular-nums text-muted">Score {p.score}</span>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
      {!listed.length && <li className="px-2 py-8 text-center text-[13px] text-muted">{live.points.length ? "No matches." : active ? "Businesses appear here as they're found." : "No businesses found."}</li>}
    </ul>
  );

  return (
    <div className="ws-live fixed inset-0 z-[60] overflow-hidden bg-bg text-fg" role="dialog" aria-modal="true" aria-label={`Live view: ${live.title}`}>
      {/* z-index 0 keeps map pins/labels inside the map layer, under the panels */}
      <div ref={box} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      {mapError && <div className="absolute inset-0 z-[1] flex items-center justify-center p-6 text-center text-sm text-muted">{mapError}</div>}
      {active && !live.points.length && (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
          <div className="ws-radar"><div className="ws-radar-ring" /></div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-44 bg-gradient-to-b from-bg/90 via-bg/40 to-transparent" />

      {/* HUD */}
      <div className={cn(panel, "ws-in-top absolute inset-x-3 top-3 z-10 px-4 py-3")}>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={live.backHref} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface hover:bg-subtle" aria-label="Exit live view"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{live.kind === "claude" ? "Claude investigation" : "Business search"}<span className="hidden sm:inline"> · #{live.shortId}</span></span>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", st.cls)}>{live.status === "RUNNING" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}{st.label}</span>
            </div>
            <h1 className="truncate text-base font-semibold sm:text-lg">{live.title}</h1>
          </div>
          <div className="hidden text-right sm:block">
            <div className="font-mono text-lg tabular-nums leading-6" suppressHydrationWarning>{elapsed}</div>
            <div className="text-[11px] text-faint">elapsed</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setFollow((f) => !f)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-medium", follow ? "border-accent/30 bg-accent/10 text-accent" : "border-border bg-surface text-muted hover:bg-subtle")} aria-pressed={follow} title="Move the map to each new find">
              <LocateFixed className="h-4 w-4" /> <span className="hidden md:inline">{follow ? "Following" : "Follow finds"}</span>
            </button>
            {canControl && live.controls.pause && <button type="button" onClick={() => control("pause")} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12.5px] font-medium hover:bg-subtle"><Pause className="h-4 w-4" /> <span className="hidden md:inline">Pause</span></button>}
            {canControl && live.controls.resume && <button type="button" onClick={() => control("resume")} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-[12.5px] font-medium text-accent-fg hover:opacity-90"><Play className="h-4 w-4" /> Resume</button>}
            {canControl && live.controls.cancel && <button type="button" onClick={() => control("cancel")} disabled={busy !== null} className="hidden h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium text-muted hover:bg-red-500/10 hover:text-red-600 sm:inline-flex"><Ban className="h-4 w-4" /> Stop</button>}
            <Link href={live.backHref} className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-subtle hover:text-fg" aria-label="Close live view"><X className="h-4 w-4" /></Link>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-[width] duration-700" style={{ width: `${Math.max(live.status === "RUNNING" ? 3 : 0, live.progress)}%` }} /></div>
          <span className="w-10 text-right text-[11px] tabular-nums text-muted">{live.progress}%</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {live.stats.map((s) => (
            <div key={s.key} className="flex items-baseline gap-1.5">
              <span key={s.value} className="ws-pop inline-block text-base font-semibold tabular-nums">{s.value.toLocaleString("en-US")}</span>
              <span className="text-[11.5px] text-muted">{s.label}</span>
            </div>
          ))}
          {live.message && <span className="ml-auto hidden max-w-[45%] truncate text-[12px] text-muted md:block">{live.message}</span>}
        </div>
      </div>

      {/* Found businesses (desktop) */}
      <aside className={cn(panel, "ws-in-left absolute bottom-3 left-3 top-[178px] z-10 hidden w-[340px] flex-col lg:flex")} aria-label="Businesses found">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <div className="text-sm font-semibold">Businesses found <span className="font-normal text-muted">({live.points.length})</span></div>
        </div>
        <div className="px-3 pb-2"><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or type…" className="h-8 w-full rounded-lg border border-border bg-surface px-3 text-[13px] placeholder:text-faint focus:border-accent/50 focus:outline-none" /></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">{list}</div>
        {kinds.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 text-[11px] text-muted">{kinds.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: pins[k] }} />{PIN_LABEL[k]}</span>)}<span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-accent/60" />Connection</span></div>}
      </aside>

      {/* Live feed or business details (desktop) */}
      <aside className={cn(panel, "ws-in-right absolute bottom-3 right-3 top-[178px] z-10 hidden w-[400px] flex-col overflow-hidden lg:flex")} aria-label={selected ? "Business details" : "Live activity"}>
        {selected ? <Details profile={profile} point={selectedPoint} pins={pins} onClose={() => setSelected(null)} on3d={on3d} now={now} /> : (
          <>
            <div className="flex items-center justify-between px-4 pb-2 pt-3"><div className="flex items-center gap-2 text-sm font-semibold">{active && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}Live activity</div><span className="text-[11px] text-faint">{live.events.length} updates</span></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">{feed}</div>
          </>
        )}
      </aside>

      {/* New-find spotlight */}
      {spotlight && !selected && !finished && (
        <button type="button" onClick={() => select(spotlight.id)} className={cn(panel, "ws-slide-up absolute left-1/2 top-[190px] z-20 flex w-[min(440px,calc(100%-24px))] -translate-x-1/2 items-center gap-3 px-4 py-3 text-left")}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${pins[kindOf(spotlight)]} 14%, transparent)`, color: pins[kindOf(spotlight)] }}><MapPin className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-600">New business found</span>
            <span className="block truncate font-semibold">{spotlight.name}</span>
            <span className="block truncate text-[12px] text-muted">{spotlight.summary ?? [spotlight.category, spotlight.city].filter(Boolean).join(" · ")}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-faint" />
        </button>
      )}

      {/* Waiting for Claude */}
      {waitingForClaude && !intro && (
        <div className={cn(panel, "ws-slide-up absolute left-1/2 top-1/2 z-10 w-[min(460px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 p-6 text-center")}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Radio className="h-6 w-6 animate-pulse" /></div>
          <h2 className="mt-3 text-lg font-semibold">Waiting for Claude</h2>
          <p className="mt-1 text-sm text-muted">Open Claude (Desktop or claude.ai) with the WebScout AI connector switched on, and say:</p>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-subtle px-3 py-2.5">
            <code className="flex-1 text-left font-mono text-sm text-accent">{live.say}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(live.say ?? "").catch(() => {})} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium hover:bg-subtle"><Copy className="h-3.5 w-3.5" /> Copy</button>
          </div>
          <p className="mt-3 text-[12px] text-faint">This screen comes alive the moment Claude starts — keep it open.</p>
        </div>
      )}

      {/* Finished */}
      {finished && !selected && (
        <div className={cn(panel, "ws-slide-up absolute bottom-24 left-1/2 z-20 w-[min(520px,calc(100%-24px))] -translate-x-1/2 p-5 lg:bottom-6")}>
          <div className="flex items-start gap-3">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", live.status === "COMPLETED" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600")}>{live.status === "COMPLETED" ? <CheckCircle2 className="h-5 w-5" /> : <Ban className="h-5 w-5" />}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{live.status === "COMPLETED" ? (live.kind === "claude" ? "Investigation complete" : "Search complete") : live.status === "FAILED" ? "Stopped with a problem" : "Stopped"}</div>
              <p className="mt-0.5 text-sm text-muted">{live.summary ?? live.error ?? `${live.points.length} businesses on the map.`}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/leads?sort=newest" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:opacity-90"><List className="h-3.5 w-3.5" /> See the leads</Link>
                <Link href={live.detailsHref} className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium hover:bg-subtle">Details</Link>
                <Link href={live.backHref} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-muted hover:bg-subtle">Close</Link>
              </div>
            </div>
          </div>
        </div>
      )}
      {live.status === "PAUSED" && (
        <div className={cn(panel, "absolute left-1/2 top-[190px] z-10 flex -translate-x-1/2 items-center gap-3 px-4 py-2.5 text-sm")}>
          <Pause className="h-4 w-4 text-amber-500" /> Paused — nothing more is saved until you resume.
          {canControl && <button type="button" onClick={() => control("resume")} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg hover:opacity-90">Resume</button>}
        </div>
      )}

      {/* Mobile: bottom sheet */}
      <div className="absolute inset-x-3 bottom-3 z-10 lg:hidden">
        {selected ? (
          <div className={cn(panel, "flex max-h-[64vh] flex-col overflow-hidden")}><Details profile={profile} point={selectedPoint} pins={pins} onClose={() => setSelected(null)} on3d={on3d} now={now} /></div>
        ) : mobilePanel ? (
          <div className={cn(panel, "flex max-h-[50vh] flex-col")}>
            <div className="flex items-center justify-between px-4 pb-1 pt-3"><div className="text-sm font-semibold">{mobilePanel === "feed" ? "Live activity" : `Businesses found (${live.points.length})`}</div><button type="button" onClick={() => setMobilePanel(null)} aria-label="Close" className="rounded-lg p-1 hover:bg-subtle"><X className="h-4 w-4" /></button></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{mobilePanel === "feed" ? feed : list}</div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setMobilePanel("feed")} className={cn(panel, "min-w-0 flex-1 px-3 py-2.5 text-left text-[13px]")}><span className="block text-[11px] text-faint">Latest</span><span className="block truncate">{live.events[0]?.message ?? "Waiting…"}</span></button>
            <button type="button" onClick={() => setMobilePanel("list")} className={cn(panel, "px-4 text-[13px] font-semibold")}>{live.points.length}<span className="block text-[10.5px] font-normal text-faint">found</span></button>
          </div>
        )}
      </div>

      {/* Intro */}
      <div className={cn("absolute inset-0 z-30 flex flex-col items-center justify-center bg-bg transition-opacity duration-700", intro ? "opacity-100" : "pointer-events-none opacity-0")} aria-hidden={!intro}>
        <div className="relative flex items-center justify-center"><div className="ws-radar" style={{ width: 220 }}><div className="ws-radar-ring" /></div><Search className="absolute h-8 w-8 text-accent" /></div>
        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">{live.kind === "claude" ? "Starting investigation" : "Starting search"}</div>
        <div className="mt-2 max-w-[80vw] truncate text-xl font-semibold">{live.title}</div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof MapPin; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{Icon && <Icon className="h-3.5 w-3.5" />}{title}</h3>
      {children}
    </section>
  );
}

function Details({ profile, point, pins, onClose, on3d, now }: { profile: Profile | null; point: Point | null; pins: Record<PinKind, string>; onClose: () => void; on3d: () => void; now: number }) {
  const name = profile?.name ?? point?.name ?? "";
  const photo = profile?.photos[0] ?? point?.imageUrl ?? null;
  const k = point ? kindOf(point) : "other";
  return (
    <div className="ws-slide-up flex min-h-0 flex-1 flex-col">
      <div className="relative h-36 shrink-0 overflow-hidden border-b border-border" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${pins[k]} 22%, rgb(var(--surface))), rgb(var(--surface)))` }}>
        {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} /> : <span className="absolute right-6 top-5 text-6xl font-bold opacity-15" style={{ color: pins[k] }}>{name.slice(0, 1)}</span>}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
        <button type="button" onClick={onClose} aria-label="Close details" className="absolute right-3 top-3 rounded-lg border border-border bg-surface/90 p-1.5 hover:bg-surface"><X className="h-4 w-4" /></button>
        <div className="absolute bottom-2 left-4 right-4">
          <div className="truncate text-lg font-semibold">{name}</div>
          <div className="truncate text-[12px] text-muted">{[profile?.category ?? point?.category, profile?.city ?? point?.city].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px] scrollbar-thin">
        {!profile ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-subtle" style={{ width: `${92 - i * 15}%` }} />)}</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${pins[k]} 12%, transparent)`, color: pins[k] }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: pins[k] }} />{profile.websiteRating?.label ? profile.websiteRating.label.replace(/^\w/, (c) => c.toUpperCase()) : point ? siteLabel(point) : "Website unknown"}</span>
              {profile.opportunity && <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent">Opportunity {profile.opportunity.score}/100</span>}
              <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[11px] text-muted" suppressHydrationWarning>Found {ago(profile.discoveredAt, now)} · {profile.source}</span>
            </div>
            <Section title="What they do">
              <p className="leading-5">{profile.whatTheyDo ?? (profile.category ? `${profile.category}${profile.city ? ` in ${profile.city}` : ""}.` : "Not described yet — run a website audit or ask Claude to research it.")}</p>
              {profile.services && <p className="mt-1.5 text-[12px] text-muted">Services: {profile.services}</p>}
            </Section>
            <dl className="space-y-1.5 rounded-xl border border-border bg-subtle/50 p-3">
              {profile.address && <div className="flex gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /><dd>{profile.address}</dd></div>}
              {profile.phone && <div className="flex gap-2"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /><dd><a href={`tel:${profile.phone}`} className="text-accent hover:underline">{profile.phone}</a></dd></div>}
              <div className="flex gap-2"><Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /><dd>{profile.website ? <a href={profile.website} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{host(profile.website)}</a> : <span className="font-medium text-amber-600">No website found</span>}</dd></div>
              {profile.email && <div className="flex gap-2"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /><dd>{profile.email}</dd></div>}
              {profile.rating != null && <div className="flex gap-2"><Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /><dd>{profile.rating.toFixed(1)}{profile.reviews ? ` from ${profile.reviews} reviews` : ""}</dd></div>}
              {profile.social.length > 0 && <div className="flex gap-2"><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /><dd className="flex flex-wrap gap-x-2">{profile.social.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="capitalize text-accent hover:underline">{s.label}</a>)}</dd></div>}
            </dl>
            {(profile.reasons.length > 0 || profile.opportunity?.summary) && (
              <Section title="Why it's a good lead" icon={Lightbulb}>
                {profile.opportunity?.summary && <p className="mb-1.5 text-[12.5px] leading-5 text-muted">{profile.opportunity.summary}</p>}
                <ul className="space-y-1">{profile.reasons.map((r) => <li key={r.label} className="flex gap-1.5"><CheckCircle2 className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", r.verified ? "text-emerald-600" : "text-faint")} /><span>{r.label}{!r.verified && <span className="ml-1 text-[10.5px] text-faint">(estimate)</span>}</span></li>)}</ul>
              </Section>
            )}
            {profile.missing.length > 0 && (
              <Section title="Missing on their website" icon={Wrench}>
                <div className="flex flex-wrap gap-1.5">{profile.missing.map((m) => <span key={m} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11.5px]">{m}</span>)}</div>
              </Section>
            )}
            {profile.websiteRating?.summary && <Section title="Website check"><p className="leading-5 text-muted">{profile.websiteRating.summary}</p></Section>}
            {profile.contacts.length > 0 && (
              <Section title="Contacts" icon={Mail}>
                <ul className="space-y-1">{profile.contacts.slice(0, 4).map((c) => <li key={c.email} className="flex items-center justify-between gap-2"><span className="truncate">{c.email}</span><span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", c.eligibility === "ELIGIBLE" ? "bg-emerald-500/10 text-emerald-700" : c.eligibility === "INELIGIBLE" ? "bg-red-500/10 text-red-700" : "bg-amber-500/10 text-amber-700")}>{c.eligibility === "ELIGIBLE" ? "OK to email" : c.eligibility === "INELIGIBLE" ? "Don't email" : "Needs review"}</span></li>)}</ul>
              </Section>
            )}
            {profile.hours.length > 0 && <Section title="Hours" icon={Clock}><ul className="space-y-0.5 text-[12px] text-muted">{profile.hours.map((h) => <li key={h}>{h}</li>)}</ul></Section>}
            {(profile.facts.length > 0 || profile.estimates.length > 0) && (
              <Section title="Research" icon={Sparkles}>
                <ul className="space-y-1.5">
                  {profile.facts.map((f, i) => <li key={`f${i}`}><span className="text-muted">{f.field.replace(/_/g, " ")}:</span> {f.value}{f.verified && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-600" aria-label="found on the source page" />}{f.sourceUrl && <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener" className="ml-1 text-[11px] text-accent hover:underline">{host(f.sourceUrl)}</a>}</li>)}
                  {profile.estimates.map((f, i) => <li key={`e${i}`}><span className="text-muted">{f.field.replace(/_/g, " ")}:</span> {f.value} <span className="rounded bg-subtle px-1 text-[10px] text-muted">estimate</span></li>)}
                </ul>
              </Section>
            )}
            {profile.sources.length > 0 && <Section title="Sources"><div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">{profile.sources.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{host(u)}</a>)}</div></Section>}
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-border bg-surface p-3">
        <button type="button" onClick={on3d} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-[12.5px] font-medium hover:bg-subtle"><Box className="h-4 w-4" /> 3D view</button>
        {point && <Link href={`/leads/${point.id}?tab=pitch`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-[12.5px] font-medium hover:bg-subtle"><Mail className="h-4 w-4" /> Quote</Link>}
        {point && <Link href={`/leads/${point.id}`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent text-[12.5px] font-semibold text-accent-fg hover:opacity-90"><ExternalLink className="h-4 w-4" /> Open lead</Link>}
      </div>
    </div>
  );
}
