"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Box, ExternalLink, Globe, MapPin, Phone, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type MapPoint = {
  id: string; name: string; lat: number | null; lng: number | null; category?: string | null; city?: string | null; address?: string | null;
  website?: string | null; phone?: string | null; imageUrl?: string | null; score?: number | null; websiteClass?: string | null; rating?: number | null; reviews?: number | null;
};

/** Free OpenStreetMap vector tiles (OpenFreeMap) with 3D building extrusions — no API key. */
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

type Kind = "high" | "nosite" | "other";
const kindOf = (p: MapPoint): Kind => ((p.score ?? 0) >= 70 ? "high" : p.websiteClass === "NO_WEBSITE" || (!p.website && p.websiteClass == null) ? "nosite" : "other");
const COLOR: Record<Kind, string> = { high: "var(--series-3)", nosite: "var(--series-2)", other: "var(--series-1)" };
const LABEL: Record<Kind, string> = { high: "High opportunity", nosite: "No website", other: "Other lead" };

/**
 * Live lead map: pins drop in (with a pulse) as businesses are found, click a pin for its card,
 * and "3D view" flies in with tilted 3D buildings around the business.
 */
export function LiveMap({ points, live = false, height = 440, className, emptyText = "Businesses appear here as they're found." }: { points: MapPoint[]; live?: boolean; height?: number; className?: string; emptyText?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLElement }>());
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [tilted, setTilted] = useState(false);
  const valid = useMemo(() => points.filter((p) => p.lat != null && p.lng != null), [points]);

  useEffect(() => {
    let cancelled = false;
    const store = markers.current;
    const timer = setTimeout(() => !cancelled && !map.current?.isStyleLoaded() && setFailed("The map is taking too long to load — check your connection."), 20000);
    import("maplibre-gl")
      .then((mod) => {
        if (cancelled || !box.current) return;
        lib.current = mod;
        const m = new mod.Map({ container: box.current, style: STYLE, center: [-79.38, 43.7], zoom: 3, attributionControl: { compact: true }, cooperativeGestures: false });
        m.addControl(new mod.NavigationControl({ visualizePitch: true }), "top-right");
        m.on("load", () => {
          if (cancelled) return;
          clearTimeout(timer);
          setReady(true);
        });
        m.on("pitchend", () => setTilted(m.getPitch() > 10));
        m.on("click", () => setSelected(null));
        map.current = m;
      })
      .catch(() => setFailed("Your browser couldn't start the map (WebGL is off or unsupported)."));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.current?.remove();
      map.current = null;
      store.clear();
    };
  }, []);

  // Add pins for new points (animated once the first batch is on screen), drop removed ones.
  useEffect(() => {
    const m = map.current;
    const mod = lib.current;
    if (!ready || !m || !mod) return;
    const seen = new Set<string>();
    const added: MapPoint[] = [];
    for (const p of valid) {
      seen.add(p.id);
      if (markers.current.has(p.id)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = cn("ws-marker", fitted.current && "is-new");
      el.style.setProperty("--pin", COLOR[kindOf(p)]);
      el.setAttribute("aria-label", `${p.name}${p.city ? `, ${p.city}` : ""}`);
      el.innerHTML = '<span class="ws-pulse"></span><span class="ws-pin"></span>';
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(p);
      });
      const marker = new mod.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lng!, p.lat!]).addTo(m);
      markers.current.set(p.id, { marker, el });
      added.push(p);
    }
    for (const [id, { marker }] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    if (!fitted.current && valid.length) {
      const b = new mod.LngLatBounds();
      for (const p of valid) b.extend([p.lng!, p.lat!]);
      m.fitBounds(b, { padding: 70, maxZoom: 14, duration: 0 });
      fitted.current = true;
    } else if (live && added.length) {
      // Follow the search: keep the newest find in view.
      const last = added[added.length - 1]!;
      if (!m.getBounds().contains([last.lng!, last.lat!])) m.easeTo({ center: [last.lng!, last.lat!], duration: 900 });
    }
  }, [valid, ready, live]);

  useEffect(() => {
    for (const [id, { el }] of markers.current) el.classList.toggle("is-selected", id === selected?.id);
  }, [selected]);

  function view3d(p: MapPoint) {
    const m = map.current;
    if (!m || p.lat == null || p.lng == null) return;
    m.flyTo({ center: [p.lng, p.lat], zoom: 17.2, pitch: 62, bearing: -25, duration: 2600, essential: true });
    m.once("moveend", () => map.current?.rotateTo(m.getBearing() + 70, { duration: 14000, easing: (t) => t }));
  }
  function flat() {
    map.current?.easeTo({ pitch: 0, bearing: 0, duration: 900 });
  }
  function toggle3d() {
    const m = map.current;
    if (!m) return;
    if (m.getPitch() > 10) flat();
    else m.easeTo({ pitch: 60, zoom: Math.max(m.getZoom(), 15.5), duration: 1200 });
  }

  const kinds = (["high", "nosite", "other"] as Kind[]).filter((k) => valid.some((p) => kindOf(p) === k));
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-subtle", className)} style={{ height }}>
      {/* inline position: maplibre-gl.css sets .maplibregl-map { position: relative }, which would collapse the container */}
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
      {failed && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">{failed}</div>}
      {!failed && !ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading map…</div>}

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1 text-xs font-medium shadow-sm ring-1 ring-border">
          {live && <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>}
          {live ? "Live · " : ""}{valid.length.toLocaleString("en-US")} on map{points.length > valid.length ? ` (${points.length - valid.length} without a location)` : ""}
        </span>
        {ready && valid.length > 0 && (
          <button type="button" onClick={toggle3d} className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-surface/95 px-3 py-1 text-xs font-medium shadow-sm ring-1 ring-border hover:bg-subtle">
            <Box className="h-3.5 w-3.5" /> {tilted ? "2D view" : "3D view"}
          </button>
        )}
      </div>

      {kinds.length > 0 && (
        <ul className="absolute left-3 top-12 space-y-1 rounded-lg bg-surface/95 px-3 py-2 text-xs shadow-sm ring-1 ring-border" aria-label="Legend">
          {kinds.map((k) => (
            <li key={k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR[k] }} /> {LABEL[k]}</li>
          ))}
        </ul>
      )}

      {ready && !valid.length && !failed && <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-muted">{emptyText}</div>}

      {selected && (
        <div className="absolute bottom-3 left-3 w-[min(320px,calc(100%-24px))] overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-border">
          {selected.imageUrl ? (
            <img src={selected.imageUrl} alt="" referrerPolicy="no-referrer" className="h-28 w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : null}
          <div className="space-y-1.5 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold">{selected.name}</div>
                <div className="truncate text-xs text-muted">{[selected.category, selected.city].filter(Boolean).join(" · ")}</div>
              </div>
              <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="rounded p-1 text-muted hover:bg-subtle hover:text-fg"><X className="h-4 w-4" /></button>
            </div>
            {selected.address && <div className="flex gap-1.5 text-xs text-muted"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{selected.address}</div>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {selected.rating != null && <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500" />{selected.rating.toFixed(1)}{selected.reviews ? ` (${selected.reviews})` : ""}</span>}
              {selected.phone && <a href={`tel:${selected.phone}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Phone className="h-3.5 w-3.5" />{selected.phone}</a>}
              {selected.website ? <a href={selected.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline"><Globe className="h-3.5 w-3.5" />Website</a> : <span className="text-muted">No website found</span>}
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLOR[kindOf(selected)] }} />{LABEL[kindOf(selected)]}{selected.score != null ? ` · score ${selected.score}` : ""}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <Link href={`/leads/${selected.id}`} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:opacity-90"><ExternalLink className="h-3.5 w-3.5" /> Open lead</Link>
              <button type="button" onClick={() => view3d(selected)} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border px-3 text-xs font-medium hover:bg-subtle"><Box className="h-3.5 w-3.5" /> 3D view</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
