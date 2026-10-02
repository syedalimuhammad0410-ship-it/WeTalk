import "server-only";
import { fetchJson } from "@/lib/server/http";
import type { ProviderContext } from "@/lib/server/settings";
import { notConfigured, wrapError, type MapProvider, type PlaceHit, type ProviderResult } from "./types";

const DAY = 86400;

interface NomRow {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type: string;
  class?: string;
  category?: string;
  importance?: number;
  extratags?: { wikidata?: string };
  address?: Record<string, string>;
}

// Nominatim usage policy: max 1 request/second. Serialize calls process-wide (cache hits bypass the network).
let nomChain: Promise<unknown> = Promise.resolve();
let nomLast = 0;
function nomThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const run = nomChain.then(async () => {
    const wait = nomLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      nomLast = Date.now();
    }
  });
  nomChain = run.catch(() => undefined);
  return run;
}

const toHit = (r: NomRow): PlaceHit => ({
  name: r.name || r.display_name.split(",")[0],
  displayName: r.display_name,
  lat: Number(r.lat),
  lng: Number(r.lon),
  kind: `${r.class || r.category || ""}:${r.type}`,
  address: r.display_name,
  osmRef: `${r.osm_type}/${r.osm_id}`,
  url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
  wikidataId: r.extratags?.wikidata,
  importance: r.importance,
});

/** OpenStreetMap Nominatim — keyless, usage policy: ≤1 req/s, cache results, identify via UA. */
export const nominatim: MapProvider = {
  id: "osm-nominatim",
  label: "OpenStreetMap Nominatim",
  configured: () => true,
  async geocode(q, n = 5) {
    try {
      const { data, cached, ms } = await nomThrottle(() =>
        fetchJson<NomRow[]>(`https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&limit=${n}&q=${encodeURIComponent(q)}`, { provider: "osm-nominatim", op: "geocode", cacheTtl: 14 * DAY, headers: { "Accept-Language": "en" }, retries: 2 }),
      );
      const items = data.map(toHit);
      return { provider: "osm-nominatim", status: items.length ? "ok" : "empty", items, cached, ms };
    } catch (e) {
      return wrapError("osm-nominatim", e);
    }
  },
  async reverse(lat, lng) {
    try {
      const { data, cached, ms } = await nomThrottle(() =>
        fetchJson<NomRow & { error?: string }>(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&extratags=1&zoom=18&lat=${lat}&lon=${lng}`, { provider: "osm-nominatim", op: "reverse", cacheTtl: 14 * DAY, headers: { "Accept-Language": "en" }, retries: 2 }),
      );
      if (data.error) return { provider: "osm-nominatim", status: "empty", items: [], cached, ms };
      return { provider: "osm-nominatim", status: "ok", items: [toHit(data)], cached, ms };
    } catch (e) {
      return wrapError("osm-nominatim", e);
    }
  },
  async searchPlaces(q, near, n = 8) {
    try {
      let extra = "";
      if (near) {
        const r = (near.radiusKm || 25) / 111;
        extra = `&viewbox=${near.lng - r},${near.lat + r},${near.lng + r},${near.lat - r}&bounded=1`;
      }
      const { data, cached, ms } = await nomThrottle(() =>
        fetchJson<NomRow[]>(`https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&limit=${n}&q=${encodeURIComponent(q)}${extra}`, { provider: "osm-nominatim", op: "places", cacheTtl: 14 * DAY, headers: { "Accept-Language": "en" }, retries: 2 }),
      );
      const items = data.map(toHit);
      return { provider: "osm-nominatim", status: items.length ? "ok" : "empty", items, cached, ms };
    } catch (e) {
      return wrapError("osm-nominatim", e);
    }
  },
  async nearby(lat, lng, radiusM = 300) {
    try {
      const q = `[out:json][timeout:8];(node(around:${radiusM},${lat},${lng})[name][~"^(amenity|tourism|leisure|shop|building|historic)$"~"."];way(around:${radiusM},${lat},${lng})[name][~"^(amenity|tourism|leisure|building|historic)$"~"."];);out center 25;`;
      const { data, cached, ms } = await fetchJson<{ elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags: Record<string, string> }[] }>(
        "https://overpass-api.de/api/interpreter",
        { provider: "osm-overpass", op: "nearby", method: "POST", body: `data=${encodeURIComponent(q)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" }, cacheTtl: 7 * DAY, timeoutMs: 10000 },
      );
      const items: PlaceHit[] = data.elements.map((el) => ({
        name: el.tags.name,
        displayName: el.tags.name,
        lat: el.lat ?? el.center!.lat,
        lng: el.lon ?? el.center!.lon,
        kind: el.tags.amenity || el.tags.tourism || el.tags.leisure || el.tags.shop || el.tags.building || el.tags.historic || "place",
        osmRef: `${el.type}/${el.id}`,
        url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        wikidataId: el.tags.wikidata,
      }));
      return { provider: "osm-overpass", status: items.length ? "ok" : "empty", items, cached, ms };
    } catch (e) {
      return wrapError("osm-overpass", e);
    }
  },
};

/** Google Maps Platform (Places API (New) + Geocoding). Requires GOOGLE_MAPS_API_KEY. */
export function googleMaps(ctx: ProviderContext): MapProvider {
  const key = ctx.secrets.GOOGLE_MAPS_API_KEY;
  const textSearch = async (q: string, n: number, near?: { lat: number; lng: number; radiusKm?: number }): Promise<ProviderResult<PlaceHit>> => {
    if (!key) return notConfigured("google-places", "GOOGLE_MAPS_API_KEY");
    try {
      const body: Record<string, unknown> = { textQuery: q, pageSize: n };
      if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: Math.min(50000, (near.radiusKm || 25) * 1000) } };
      const { data, cached, ms } = await fetchJson<{
        places?: { id: string; displayName?: { text: string }; formattedAddress?: string; location: { latitude: number; longitude: number }; primaryType?: string; googleMapsUri?: string }[];
      }>("https://places.googleapis.com/v1/places:searchText", {
        provider: "google-places",
        op: "textSearch",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.googleMapsUri",
        },
        body: JSON.stringify(body),
        cacheTtl: 7 * DAY,
        costUnits: 32,
      });
      const items: PlaceHit[] = (data.places || []).map((p) => ({
        name: p.displayName?.text || p.formattedAddress || "Place",
        displayName: `${p.displayName?.text || ""}, ${p.formattedAddress || ""}`,
        lat: p.location.latitude,
        lng: p.location.longitude,
        kind: p.primaryType || "place",
        address: p.formattedAddress,
        placeId: p.id,
        url: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${p.id}`,
      }));
      return { provider: "google-places", status: items.length ? "ok" : "empty", items, cached, ms };
    } catch (e) {
      return wrapError("google-places", e);
    }
  };
  return {
    id: "google",
    label: "Google Maps Platform",
    configured: () => Boolean(key),
    geocode: (q, n = 5) => textSearch(q, n),
    searchPlaces: (q, near, n = 8) => textSearch(q, n, near),
    async reverse(lat, lng) {
      if (!key) return notConfigured("google-geocoding", "GOOGLE_MAPS_API_KEY");
      try {
        const { data, cached, ms } = await fetchJson<{ results: { formatted_address: string; place_id: string; types: string[] }[]; status: string }>(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`,
          { provider: "google-geocoding", op: "reverse", cacheTtl: 14 * DAY, costUnits: 5 },
        );
        const items: PlaceHit[] = data.results.slice(0, 3).map((r) => ({
          name: r.formatted_address.split(",")[0],
          displayName: r.formatted_address,
          lat,
          lng,
          kind: r.types[0] || "address",
          address: r.formatted_address,
          placeId: r.place_id,
          url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${r.place_id}`,
        }));
        return { provider: "google-geocoding", status: items.length ? "ok" : "empty", items, cached, ms };
      } catch (e) {
        return wrapError("google-geocoding", e);
      }
    },
  };
}

export function mapProvider(ctx: ProviderContext): MapProvider {
  if (ctx.prefs.mapProvider === "google" && ctx.secrets.GOOGLE_MAPS_API_KEY) return googleMaps(ctx);
  return nominatim;
}
