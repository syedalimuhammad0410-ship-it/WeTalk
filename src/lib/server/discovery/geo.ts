import "../guard";
import { AppError, fetchWithTimeout } from "../errors";

export type Bounds = { south: number; west: number; north: number; east: number };
export type LatLng = { lat: number; lng: number };
export type Area = { label: string; bounds: Bounds; center: LatLng; source: "google" | "openstreetmap" };

/** Bounding box of a circle (radius in km) around a point. */
export function circleBounds(c: LatLng, km: number): Bounds {
  const dLat = km / 111.32;
  const dLng = km / Math.max(1, 111.32 * Math.cos((c.lat * Math.PI) / 180));
  return { south: Math.max(-85, c.lat - dLat), west: c.lng - dLng, north: Math.min(85, c.lat + dLat), east: c.lng + dLng };
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const KM_PER_DEG_LAT = 111.32;
const kmPerDegLng = (lat: number) => Math.max(1, KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

export function boundsSizeKm(b: Bounds) {
  const mid = (b.north + b.south) / 2;
  return { heightKm: (b.north - b.south) * KM_PER_DEG_LAT, widthKm: (b.east - b.west) * kmPerDegLng(mid) };
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const clampLat = (n: number) => Math.max(-85, Math.min(85, n));
const roundBounds = (b: Bounds): Bounds => ({ south: round(clampLat(b.south)), west: round(b.west), north: round(clampLat(b.north)), east: round(b.east) });

/** Stable identifier for a searched cell (used to avoid repeating identical searches). */
export function cellKey(b: Bounds) {
  return [b.south, b.west, b.north, b.east].map((n) => n.toFixed(3)).join(",");
}

/**
 * Splits an area into a grid of cells no larger than `maxCellKm` on a side,
 * each grown by `overlap` (fraction) so businesses on a border are not missed.
 */
export function tileBounds(b: Bounds, maxCellKm: number, overlap = 0.05): Bounds[] {
  const { heightKm, widthKm } = boundsSizeKm(b);
  const rows = Math.max(1, Math.ceil(heightKm / maxCellKm));
  const cols = Math.max(1, Math.ceil(widthKm / maxCellKm));
  const dLat = (b.north - b.south) / rows;
  const dLng = (b.east - b.west) / cols;
  const out: Bounds[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = b.south + r * dLat;
      const w = b.west + c * dLng;
      const padLat = rows > 1 ? dLat * overlap : 0;
      const padLng = cols > 1 ? dLng * overlap : 0;
      out.push(roundBounds({ south: s - padLat, west: w - padLng, north: s + dLat + padLat, east: w + dLng + padLng }));
    }
  }
  return out;
}

/** Splits a saturated cell into four overlapping quadrants. */
export function splitBounds(b: Bounds): Bounds[] {
  return tileBounds(b, Math.max(boundsSizeKm(b).heightKm, boundsSizeKm(b).widthKm) / 2 + 0.001, 0.04);
}

/** True when a cell is still big enough to be worth splitting further. */
export function canSplit(b: Bounds, depth: number) {
  const { heightKm, widthKm } = boundsSizeKm(b);
  return depth < 8 && Math.max(heightKm, widthKm) > 1.2;
}

/** Initial cell size: whole small areas are searched as one cell; big ones are tiled. */
export function initialCellKm(b: Bounds) {
  const { heightKm, widthKm } = boundsSizeKm(b);
  const span = Math.max(heightKm, widthKm);
  if (span <= 60) return span + 1; // a city: one cell, split adaptively where dense
  if (span <= 400) return 50; // metro area / region
  if (span <= 1500) return 100; // province / state
  return 200; // country
}

/** Splits "Toronto; Mississauga, Brampton" style input into separate locations ("Mississauga, Ontario" stays whole). */
export function parseLocations(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/\n|;/);
  return Array.from(new Set(raw.map((s) => s.trim()).filter((s) => s.length >= 2))).slice(0, 50);
}

/** Looks up an area's bounding box with Google (Places Text Search viewport). */
export async function resolveAreaWithGoogle(apiKey: string, location: string): Promise<Area> {
  const res = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
    service: "Google Places API",
    timeoutMs: 20000,
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.viewport,places.location,places.formattedAddress" },
    body: JSON.stringify({ textQuery: location, pageSize: 1 }),
  });
  const data = (await res.json().catch(() => null)) as { places?: { viewport?: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } }; location?: { latitude: number; longitude: number }; formattedAddress?: string }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new AppError(res.status === 403 ? "INVALID_CREDENTIALS" : res.status === 429 ? "QUOTA_EXCEEDED" : "UPSTREAM_ERROR", `Google could not look up “${location}”: ${data?.error?.message ?? `HTTP ${res.status}`}`);
  const p = data?.places?.[0];
  if (!p?.location) throw new AppError("NOT_FOUND", `Could not find the location “${location}”. Try “City, Province” or “Province, Country”.`);
  const v = p.viewport;
  const bounds = v
    ? { south: v.low.latitude, west: v.low.longitude, north: v.high.latitude, east: v.high.longitude }
    : { south: p.location.latitude - 0.1, west: p.location.longitude - 0.15, north: p.location.latitude + 0.1, east: p.location.longitude + 0.15 };
  return { label: p.formattedAddress ?? location, bounds: roundBounds(bounds), center: { lat: p.location.latitude, lng: p.location.longitude }, source: "google" };
}

let lastNominatim = 0;
/** Looks up an area's bounding box with OpenStreetMap Nominatim (max 1 request/second, per its usage policy). */
export async function resolveAreaWithOsm(location: string): Promise<Area> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetchWithTimeout(`${process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org"}/search?format=json&limit=1&q=${encodeURIComponent(location)}`, {
    service: "OpenStreetMap Nominatim",
    timeoutMs: 20000,
    headers: { "User-Agent": "WebScoutAI/1.0 (business discovery for a web agency)", Accept: "application/json" },
  });
  if (!res.ok) throw new AppError("UPSTREAM_ERROR", `OpenStreetMap could not look up “${location}” (HTTP ${res.status}).`);
  const rows = (await res.json().catch(() => [])) as { boundingbox?: [string, string, string, string]; display_name?: string; lat?: string; lon?: string }[];
  const bb = rows[0]?.boundingbox;
  if (!bb) throw new AppError("NOT_FOUND", `Could not find the location “${location}”.`);
  const [s, n, w, e] = bb.map(Number) as [number, number, number, number];
  const center = rows[0]!.lat && rows[0]!.lon ? { lat: Number(rows[0]!.lat), lng: Number(rows[0]!.lon) } : { lat: (s + n) / 2, lng: (w + e) / 2 };
  return { label: rows[0]!.display_name ?? location, bounds: roundBounds({ south: s, west: w, north: n, east: e }), center, source: "openstreetmap" };
}
