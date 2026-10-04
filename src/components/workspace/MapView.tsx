"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, LayersControl, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { Crosshair, ExternalLink, Landmark, MapPinPlus, Play, Search, Square, X } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { api, proxied } from "@/lib/client/api";
import { Button, ConfidenceBadge, Label, cn, inputCls } from "@/components/ui";
import { mapsLinks } from "@/components/StaticMap";
import type { GeoLocation } from "@/lib/types";
import { nowIso, uid } from "@/lib/util";

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(points, { padding: [60, 60], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function FlyTo({ target }: { target: { at: [number, number]; zoom?: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target.at, target.zoom ?? Math.max(map.getZoom(), 15), { duration: target.zoom ? 2.4 : 1.2 });
  }, [target, map]);
  return null;
}

const PRECISION_ZOOM: Record<string, number> = { exact: 17, street: 16, neighbourhood: 14, city: 11, region: 7, country: 5 };
const PRECISION_RADIUS: Record<string, number> = { exact: 120, street: 350, neighbourhood: 1500, city: 8000, region: 80000, country: 400000 };
const precisionOf = (l: GeoLocation) => (l.kind.startsWith("ai-") ? l.kind.slice(3) : "exact");

const iconCache = new Map<string, L.DivIcon>();
function radarIcon(color: string, lead: boolean, drop: boolean) {
  const k = `${color}|${lead}|${drop}`;
  if (!iconCache.has(k))
    iconCache.set(
      k,
      L.divIcon({
        className: "radar-pin-icon",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        html: `<div class="radar-pin${lead ? " lead" : ""}${drop ? " drop" : ""}" style="--pin:${color}"><span class="ring"></span><span class="ring"></span><span class="ring"></span><span class="core"></span></div>`,
      }),
    );
  return iconCache.get(k)!;
}

function ClickToAdd({ active, onAdd }: { active: boolean; onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => active && onAdd(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function MapView() {
  const inv = useWorkspace((s) => s.inv)!;
  const selCand = useWorkspace((s) => s.selectedCandidateId);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [nearby, setNearby] = useState<{ name: string; kind: string; lat: number; lng: number; url: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fly, setFly] = useState<{ at: [number, number]; zoom?: number; key: number } | null>(null);
  const [lock, setLock] = useState<{ name: string; sub: string; confirmed: boolean; key: number } | null>(null);
  const [tour, setTour] = useState(false);
  const locates = useWorkspace((s) => s.locates);
  const seenLocates = useRef(0);
  const clearLock = useMemo(() => () => setLock(null), []);

  const candByLoc = useMemo(() => new Map(inv.candidates.filter((c) => c.locationId).map((c) => [c.locationId!, c])), [inv.candidates]);
  const points = inv.locations.map((l) => [l.lat, l.lng] as [number, number]);
  useEffect(() => {
    const c = inv.candidates.find((x) => x.id === selCand);
    if (c?.locationId) setSelected(c.locationId);
  }, [selCand, inv.candidates]);
  const loc = inv.locations.find((l) => l.id === selected);
  const cand = loc ? candByLoc.get(loc.id) : undefined;
  const lead = inv.candidates.find((c) => c.status === "leading");
  const leadLoc = lead && inv.locations.find((l) => l.id === lead.locationId);

  async function addAt(lat: number, lng: number) {
    setAdding(false);
    setBusy("Looking up location…");
    try {
      const r = await api.post<{ items: { name: string; displayName: string; kind: string }[] }>("/api/search/maps", { op: "reverse", lat, lng });
      const hit = r.items[0];
      const l: GeoLocation = { id: uid("loc"), name: hit?.name || "User-selected location", address: hit?.displayName, lat, lng, kind: "user-selected", sourceIds: [], userSelected: true };
      ws.update((i) => ({ ...i, locations: [...i.locations, l], notes: [...i.notes, { id: uid("note"), text: `User-selected map location: ${l.name} (${lat.toFixed(5)}, ${lng.toFixed(5)})`, createdAt: nowIso(), tags: ["map"] }] }));
      setSelected(l.id);
    } catch (e) {
      ws.log(`Reverse geocode failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(null);
    }
  }
  async function loadNearby(l: GeoLocation) {
    setBusy("Searching nearby public landmarks (OpenStreetMap)…");
    try {
      const r = await api.post<{ status: string; error?: string; items: { name: string; kind: string; lat: number; lng: number; url: string }[] }>("/api/search/maps", { op: "nearby", lat: l.lat, lng: l.lng, radiusM: 400 });
      if (r.status === "error") throw new Error(r.error);
      setNearby(r.items.slice(0, 20));
    } catch (e) {
      ws.log(`Nearby search failed: ${e instanceof Error ? e.message : e}`, "warn");
      setNearby([]);
    } finally {
      setBusy(null);
    }
  }

  const lockOn = (l: GeoLocation, sub?: string) => {
    const c = candByLoc.get(l.id);
    const confirmed = !c?.against.some((a) => /could not confirm|unconfirmed/i.test(a));
    setFly({ at: [l.lat, l.lng], zoom: PRECISION_ZOOM[precisionOf(l)] ?? 15, key: Date.now() });
    setLock({ name: l.name, sub: sub || `${precisionOf(l)} precision · ${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`, confirmed, key: Date.now() });
    setSelected(l.id);
  };
  // fly to each new AI location fix as it arrives during a run
  useEffect(() => {
    if (locates.length <= seenLocates.current) {
      seenLocates.current = locates.length;
      return;
    }
    const f = locates[locates.length - 1];
    seenLocates.current = locates.length;
    const l = inv.locations.find((x) => Math.abs(x.lat - f.lat) < 1e-6 && Math.abs(x.lng - f.lng) < 1e-6) || { id: "", name: f.name, lat: f.lat, lng: f.lng, kind: `ai-${f.precision}`, sourceIds: [] };
    lockOn(l as GeoLocation, `Possible location · ${Math.round(f.confidence * 100)}% AI · ${f.confirmed ? "map-confirmed" : "unconfirmed estimate"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locates.length]);
  // guided tour through every possible location, best first
  const tourList = useMemo(
    () =>
      inv.candidates
        .filter((c) => c.status !== "rejected")
        .map((c) => inv.locations.find((l) => l.id === c.locationId))
        .filter(Boolean) as GeoLocation[],
    [inv.candidates, inv.locations],
  );
  useEffect(() => {
    if (!tour || !tourList.length) return;
    let i = 0;
    lockOn(tourList[0], `Possible location 1/${tourList.length}`);
    const id = setInterval(() => {
      i++;
      if (i >= tourList.length) {
        setTour(false);
        return;
      }
      lockOn(tourList[i], `Possible location ${i + 1}/${tourList.length}`);
    }, 5200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, tourList.length]);

  const color = (l: GeoLocation) => {
    const c = candByLoc.get(l.id);
    if (l.userSelected) return "#f2b84b";
    if (!c) return "#9aa3ad";
    return c.status === "leading" ? "#ff7a45" : c.status === "rejected" ? "#646d77" : "#59d4e8";
  };

  return (
    <div className="relative h-full">
      <MapContainer center={[20, 0]} zoom={2} className="h-full w-full" worldCopyJump zoomControl preferCanvas>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Streets (OpenStreetMap)">
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' className="dim-tiles" maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite (Esri World Imagery)">
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community" maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Terrain (OpenTopoMap)">
            <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" attribution='Map data: &copy; OpenStreetMap contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' maxZoom={17} />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitBounds points={points} />
        <FlyTo target={fly} />
        <ClickToAdd active={adding} onAdd={addAt} />
        {leadLoc && <Circle center={[leadLoc.lat, leadLoc.lng]} radius={600} pathOptions={{ color: "#ff7a45", weight: 1, dashArray: "4 6", fillOpacity: 0.04 }} />}
        {inv.locations
          .filter((l) => l.kind.startsWith("ai-") && precisionOf(l) !== "exact")
          .map((l) => (
            <Circle key={`u${l.id}`} center={[l.lat, l.lng]} radius={PRECISION_RADIUS[precisionOf(l)] ?? 1000} pathOptions={{ color: color(l), weight: 1, dashArray: "3 6", fillOpacity: 0.05 }} />
          ))}
        {inv.locations.map((l) => {
          const c = candByLoc.get(l.id);
          const live = c && c.status !== "rejected";
          return live ? (
            <Marker key={l.id} position={[l.lat, l.lng]} icon={radarIcon(color(l), c.status === "leading", true)} eventHandlers={{ click: () => lockOn(l) }} zIndexOffset={c.status === "leading" ? 1000 : 0}>
              <Tooltip direction="top" offset={[0, -10]}>
                {l.name}
                {(c.signals.ai ?? 0) > 0 ? " · AI geolocation" : ""}
              </Tooltip>
            </Marker>
          ) : (
            <CircleMarker key={l.id} center={[l.lat, l.lng]} radius={l.id === selected ? 10 : 7} pathOptions={{ color: "#050608", weight: 2, fillColor: color(l), fillOpacity: 0.95 }} eventHandlers={{ click: () => setSelected(l.id) }}>
              <Tooltip direction="top" offset={[0, -8]}>
                {l.name}
              </Tooltip>
            </CircleMarker>
          );
        })}
        {nearby?.map((n, i) => (
          <CircleMarker key={`n${i}`} center={[n.lat, n.lng]} radius={4} pathOptions={{ color: "#8b5cf6", fillColor: "#a78bfa", fillOpacity: 0.9, weight: 1 }}>
            <Tooltip>
              {n.name} · {n.kind}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* controls */}
      <div className="absolute left-14 right-16 top-3 z-[500] flex flex-wrap gap-2">
        <form
          className="flex"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length > 1) void ws.search("maps", q.trim(), { userAdded: true });
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place…" aria-label="Search a place" className={cn(inputCls, "h-8 w-44 rounded-r-none !bg-panel/95 sm:w-56")} />
          <button className="h-8 rounded-r-[5px] border border-l-0 border-line-strong bg-panel/95 px-2.5 text-dim hover:text-fg" aria-label="Search">
            <Search className="size-3.5" />
          </button>
        </form>
        {tourList.length > 0 && (
          <Button size="sm" variant={tour ? "subtle" : "outline"} className="h-8 !bg-panel/95 backdrop-blur" onClick={() => setTour((t) => !t)}>
            {tour ? <Square className="size-3.5" /> : <Play className="size-3.5" />} {tour ? "Stop tour" : `Tour possible locations (${tourList.length})`}
          </Button>
        )}
        <Button size="sm" variant={adding ? "subtle" : "outline"} className="h-8 !bg-panel/95 backdrop-blur" onClick={() => setAdding((a) => !a)}>
          <MapPinPlus className="size-3.5" /> {adding ? "Click the map…" : "Add location"}
        </Button>
      </div>
      <div className="absolute bottom-3 left-3 z-[500] flex flex-wrap gap-3 rounded-[5px] border border-line bg-panel/95 px-3 py-2 text-[11px] text-dim">
        <Legend c="#ff7a45" t="Leading" />
        <Legend c="#59d4e8" t="Candidate" />
        <Legend c="#646d77" t="Rejected" />
        <Legend c="#f2b84b" t="User-selected" />
        <Legend c="#a78bfa" t="Nearby landmark" />
      </div>
      {lock && <LockOverlay key={lock.key} name={lock.name} sub={lock.sub} confirmed={lock.confirmed} onDone={clearLock} />}
      {busy && <div className="absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded bg-black/85 px-3 py-1.5 text-[12px] text-cyan">{busy}</div>}

      {loc && (
        <aside className="absolute bottom-3 right-3 top-14 z-[500] w-[330px] max-w-[calc(100%-24px)] overflow-y-auto rounded-card border border-line-strong bg-panel/97 shadow-2xl backdrop-blur">
          <div className="sticky top-0 flex items-start gap-2 border-b border-line bg-panel p-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">{loc.name}</div>
              {cand && (
                <div className="mt-1">
                  <ConfidenceBadge value={cand.confidence} />
                </div>
              )}
            </div>
            <button aria-label="Close details" onClick={() => setSelected(null)} className="rounded p-1 text-mute hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-3 p-3 text-[12.5px]">
            {loc.address && <div className="text-dim">{loc.address}</div>}
            <div className="font-mono text-[11.5px]">
              {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(mapsLinks(loc.lat, loc.lng, loc.name))
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <a key={k} href={v!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[4px] border border-line-strong px-2 py-1 text-[11.5px] hover:border-cyan/50">
                    Open in {k === "googleCoords" ? "Google Maps" : k === "googleName" ? "Google (by name)" : k === "osm" ? "OpenStreetMap" : "Apple Maps"} <ExternalLink className="size-3" />
                  </a>
                ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => lockOn(loc)}>
                <Crosshair className="size-3.5" /> Zoom here
              </Button>
              <Button size="sm" variant="ghost" onClick={() => loadNearby(loc)}>
                <Landmark className="size-3.5" /> Nearby landmarks
              </Button>
            </div>
            {nearby && (
              <div>
                <Label className="mb-1">Nearby public landmarks ({nearby.length})</Label>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-[12px]">
                  {nearby.length === 0 && <li className="text-mute">None found within 400 m.</li>}
                  {nearby.map((n, i) => (
                    <li key={i}>
                      <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-cyan">
                        {n.name}
                      </a>{" "}
                      <span className="text-mute">· {n.kind}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cand && (
              <>
                <div>
                  <Label className="mb-1">Evidence</Label>
                  <ul className="space-y-1">
                    {cand.why.slice(0, 4).map((w, i) => (
                      <li key={i} className="text-dim">
                        ✓ {w}
                      </li>
                    ))}
                    {cand.against.slice(0, 3).map((w, i) => (
                      <li key={`a${i}`} className="text-warn/90">
                        ⚠ {w.replace(/^⚠ /, "")}
                      </li>
                    ))}
                  </ul>
                </div>
                {cand.images.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto">
                    {cand.images.slice(0, 5).map((im) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={im.id} src={proxied(im.thumb)} alt={im.title} className="h-16 w-24 shrink-0 rounded-[3px] object-cover" loading="lazy" />
                    ))}
                  </div>
                )}
                <div>
                  <Label className="mb-1">Related organizations</Label>
                  <div className="text-dim">{cand.derivedFrom.join(", ") || "—"}</div>
                </div>
                <div>
                  <Label className="mb-1">Timeline</Label>
                  <ul className="space-y-0.5 text-dim">
                    {inv.timeline
                      .filter((t) => t.candidateId === cand.id)
                      .sort((a, b) => a.year - b.year)
                      .slice(0, 8)
                      .map((t) => (
                        <li key={t.id}>
                          <span className="font-mono text-fg">{t.year}</span> {t.label}
                        </li>
                      ))}
                  </ul>
                </div>
              </>
            )}
            <div>
              <Label className="mb-1">Sources</Label>
              <ul className="space-y-0.5">
                {inv.sources
                  .filter((s) => (cand?.sourceIds || loc.sourceIds).includes(s.id))
                  .slice(0, 8)
                  .map((s) => (
                    <li key={s.id}>
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                        {s.title}
                      </a>
                    </li>
                  ))}
                {loc.userSelected && <li className="text-warn">User-selected (no external source)</li>}
              </ul>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

/** Target-lock animation shown while the map flies to a possible location. */
function LockOverlay({ name, sub, confirmed, onDone }: { name: string; sub: string; confirmed: boolean; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 4800);
    return () => clearTimeout(id);
  }, [onDone]);
  const col = confirmed ? "#ff5a5a" : "#f2b84b";
  return (
    <div className="pointer-events-none absolute inset-0 z-[450] overflow-hidden">
      <div className="lock-reticle" style={{ ["--lock" as string]: col }}>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="absolute left-1/2 top-[calc(50%+56px)] -translate-x-1/2 animate-[lock-label_0.4s_1.4s_both] whitespace-nowrap rounded-[3px] border bg-black/80 px-3 py-1.5 text-center backdrop-blur" style={{ borderColor: col }}>
        <div className="font-mono text-[10px] tracking-[0.2em]" style={{ color: col }}>
          {confirmed ? "⌖ LOCATION LOCKED" : "⌖ POSSIBLE LOCATION (UNCONFIRMED)"}
        </div>
        <div className="text-[13px] font-semibold">{name}</div>
        <div className="font-mono text-[10.5px] text-dim">{sub}</div>
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: c }} />
      {t}
    </span>
  );
}
