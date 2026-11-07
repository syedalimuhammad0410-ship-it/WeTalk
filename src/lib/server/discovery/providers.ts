import "../guard";
import { db } from "../../db";
import { AppError, describeError, fetchWithTimeout } from "../errors";
import { resolveIntegrationKey } from "../workspace";
import type { BusinessInput } from "../leads";
import { PLACES_FIELD_MASK, placesRequest, placeToBusiness, type Place } from "./places";
import type { Bounds } from "./geo";

export const PROVIDER_IDS = ["google_places", "openstreetmap"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type FoundBusiness = BusinessInput & { types: string[]; chain?: boolean };
export type SearchPage = { items: FoundBusiness[]; nextPageToken: string | null };

export type DiscoveryProvider = {
  id: ProviderId;
  label: string;
  description: string;
  /** Estimated cost per request in US cents (shown as an estimate only). */
  costPerRequestCents: number;
  defaultDailyLimit: number;
  attribution?: string;
  /** Can this provider be used by the workspace right now? */
  available(workspaceId: string): Promise<{ ok: boolean; reason?: string }>;
  search(workspaceId: string, query: string, bounds: Bounds, pageToken: string | null): Promise<SearchPage>;
  /** Pages per zone before the zone is considered complete. */
  maxPages: number;
  /** A zone that returned this many results probably has more: it is split into four. */
  saturatedAt: number;
};

// ───────────── Google Places (Text Search, rectangle-restricted) ─────────────

const google: DiscoveryProvider = {
  id: "google_places",
  label: "Google Places API",
  description: "Text Search restricted to each zone's rectangle (20 results per request, up to 60 per zone).",
  costPerRequestCents: 3.5,
  defaultDailyLimit: 1000,
  maxPages: 3,
  saturatedAt: 60,
  async available(workspaceId) {
    const key = await resolveIntegrationKey(workspaceId, "GOOGLE_PLACES").catch(() => null);
    return key ? { ok: true } : { ok: false, reason: "No Google Places API key (Settings → Business Discovery & AI keys)." };
  },
  async search(workspaceId, query, b, pageToken) {
    const key = await resolveIntegrationKey(workspaceId, "GOOGLE_PLACES");
    if (!key) throw new AppError("NOT_CONFIGURED", "Connect the Google Places API in Settings to use it for discovery.");
    const r = await placesRequest<{ places?: Place[]; nextPageToken?: string }>(
      key.key,
      {
        textQuery: query,
        pageSize: 20,
        ...(pageToken ? { pageToken } : {}),
        locationRestriction: { rectangle: { low: { latitude: b.south, longitude: b.west }, high: { latitude: b.north, longitude: b.east } } },
      },
      PLACES_FIELD_MASK,
    );
    return { items: (r.places ?? []).map(placeToBusiness), nextPageToken: r.nextPageToken ?? null };
  },
};

// ───────────── OpenStreetMap (Overpass API, ODbL) ─────────────

const OSM_LIMIT = 400;
const GENERIC_WORDS = new Set(["company", "companies", "service", "services", "business", "businesses", "local", "best", "near", "me", "the", "and", "in", "of", "for", "shop", "shops", "store", "stores", "small", "commercial", "residential", "professional", "professionals"]);

/** OSM tags that correspond to common search categories (keyword stem → tag filters). */
const KEYWORD_TAGS: [RegExp, string[]][] = [
  [/clean|janitor|maid/i, ['["craft"="cleaning"]', '["shop"="dry_cleaning"]', '["office"="cleaning"]']],
  [/restaurant|diner|bistro|eatery/i, ['["amenity"="restaurant"]']],
  [/cafe|coffee/i, ['["amenity"="cafe"]']],
  [/bakery|bakeries/i, ['["shop"="bakery"]']],
  [/dent/i, ['["amenity"="dentist"]', '["healthcare"="dentist"]']],
  [/plumb/i, ['["craft"="plumber"]']],
  [/electric/i, ['["craft"="electrician"]']],
  [/roof/i, ['["craft"="roofer"]']],
  [/hvac|heating|air condition/i, ['["craft"="hvac"]']],
  [/landscap|lawn|garden/i, ['["craft"="gardener"]', '["shop"="garden_centre"]']],
  [/hair|salon|barber/i, ['["shop"="hairdresser"]', '["shop"="beauty"]']],
  [/beauty|spa|nail/i, ['["shop"="beauty"]']],
  [/auto|mechanic|car repair|garage/i, ['["shop"="car_repair"]']],
  [/construct|contractor|builder|renovat/i, ['["craft"="builder"]', '["office"="construction_company"]', '["craft"="carpenter"]']],
  [/lawyer|law firm|legal/i, ['["office"="lawyer"]']],
  [/account|bookkeep|tax/i, ['["office"="accountant"]', '["office"="tax_advisor"]']],
  [/real estate|realtor/i, ['["office"="estate_agent"]']],
  [/insurance/i, ['["office"="insurance"]']],
  [/gym|fitness/i, ['["leisure"="fitness_centre"]']],
  [/florist|flower/i, ['["shop"="florist"]']],
  [/vet|animal hospital/i, ['["amenity"="veterinary"]']],
  [/chiropract|physio|clinic|therap|massage/i, ['["healthcare"]', '["shop"="massage"]']],
  [/pet groom|pet/i, ['["shop"="pet_grooming"]', '["shop"="pet"]']],
  [/photograph/i, ['["craft"="photographer"]', '["shop"="photo"]']],
  [/print/i, ['["shop"="copyshop"]', '["craft"="printer"]']],
  [/tailor|alteration/i, ['["craft"="tailor"]', '["shop"="tailor"]']],
  [/office/i, ['["office"="company"]']],
];

/** OSM values mapped to the Google-style types the small-business filter understands. */
const OSM_TYPE_MAP: Record<string, string> = {
  fuel: "gas_station", mall: "shopping_mall", place_of_worship: "place_of_worship", attraction: "tourist_attraction", museum: "museum", hospital: "hospital",
  school: "school", university: "university", college: "university", bank: "bank", atm: "atm", supermarket: "supermarket", department_store: "department_store",
  park: "park", stadium: "stadium", theme_park: "amusement_park", zoo: "zoo", aquarium: "aquarium", townhall: "city_hall", police: "police", library: "library",
};

function stem(query: string) {
  const words = query.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC_WORDS.has(w));
  const w = words.sort((a, b) => b.length - a.length)[0] ?? query.toLowerCase().trim();
  return w.replace(/(ing|ers|ies|es|s)$/i, "").slice(0, 30) || w;
}

export function overpassQuery(query: string, b: Bounds) {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const tags = KEYWORD_TAGS.filter(([re]) => re.test(query)).flatMap(([, t]) => t);
  const s = stem(query).replace(/[\\"^$.|?*+()[\]{}]/g, "");
  const nameFilters = ["shop", "craft", "office", "amenity", "healthcare"].map((k) => `nwr["name"~"${s}",i]["${k}"](${bbox});`);
  const tagFilters = tags.map((t) => `nwr${t}["name"](${bbox});`);
  return `[out:json][timeout:60];(${[...tagFilters, ...nameFilters].join("")});out center tags ${OSM_LIMIT};`;
}

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

export function osmToBusiness(el: OsmElement): FoundBusiness | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const kind = t.shop ?? t.craft ?? t.office ?? t.amenity ?? t.healthcare ?? t.leisure ?? t.tourism ?? null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const city = t["addr:city"] ?? null;
  const address = [street, city, t["addr:province"] ?? t["addr:state"], t["addr:postcode"]].filter(Boolean).join(", ") || null;
  const email = (t.email ?? t["contact:email"] ?? "").split(";")[0]?.trim().toLowerCase() || null;
  const values = [t.shop, t.craft, t.office, t.amenity, t.healthcare, t.leisure, t.tourism].filter(Boolean) as string[];
  const url = `https://www.openstreetmap.org/${el.type}/${el.id}`;
  return {
    name: t.name,
    category: kind ? kind.replace(/_/g, " ") : null,
    address,
    city,
    region: t["addr:province"] ?? t["addr:state"] ?? null,
    country: t["addr:country"] ?? null,
    postalCode: t["addr:postcode"] ?? null,
    latitude: el.lat ?? el.center?.lat ?? null,
    longitude: el.lon ?? el.center?.lon ?? null,
    phone: t.phone ?? t["contact:phone"] ?? null,
    website: t.website ?? t["contact:website"] ?? t.url ?? null,
    email: email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : null,
    emailSource: email ? "Listed on OpenStreetMap" : null,
    emailClassification: "PUBLIC_DIRECTORY",
    emailSourceUrl: url,
    hours: t.opening_hours ? [t.opening_hours] : [],
    googleMapsUrl: null,
    operationalStatus: t.disused || t["disused:shop"] ? "CLOSED_PERMANENTLY" : null,
    source: "OPENSTREETMAP",
    sourceId: `${el.type}/${el.id}`,
    types: values.map((v) => OSM_TYPE_MAP[v] ?? v),
    chain: Boolean(t.brand || t["brand:wikidata"]),
  };
}

const osm: DiscoveryProvider = {
  id: "openstreetmap",
  label: "OpenStreetMap (Overpass API)",
  description: "Free, community-maintained map data (ODbL licence). Often includes websites and sometimes public emails.",
  costPerRequestCents: 0,
  defaultDailyLimit: 500,
  maxPages: 1,
  saturatedAt: OSM_LIMIT,
  attribution: "© OpenStreetMap contributors (ODbL)",
  async available() {
    return { ok: true };
  },
  async search(_workspaceId, query, b) {
    const res = await fetchWithTimeout(process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter", {
      service: "OpenStreetMap Overpass API",
      timeoutMs: 90000,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "WebScoutAI/1.0 (business discovery for a web agency)", Accept: "application/json" },
      body: `data=${encodeURIComponent(overpassQuery(query, b))}`,
    });
    if (res.status === 429) throw new AppError("RATE_LIMITED", "OpenStreetMap's Overpass API is busy (rate limited). The zone will be retried.");
    if (!res.ok) throw new AppError("UPSTREAM_ERROR", `OpenStreetMap Overpass API error (HTTP ${res.status}).`);
    const data = (await res.json().catch(() => null)) as { elements?: OsmElement[] } | null;
    if (!data) throw new AppError("MALFORMED_RESPONSE", "OpenStreetMap returned an unreadable response.");
    return { items: (data.elements ?? []).map(osmToBusiness).filter((x): x is FoundBusiness => Boolean(x)), nextPageToken: null };
  },
};

export const PROVIDERS: Record<ProviderId, DiscoveryProvider> = { google_places: google, openstreetmap: osm };

// ───────────── Settings & usage ─────────────

const today = () => new Date().toISOString().slice(0, 10);

export async function providerSettings(workspaceId: string) {
  const rows = await db.discoveryProviderSetting.findMany({ where: { workspaceId } });
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => {
      const r = rows.find((x) => x.provider === id);
      return [id, { enabled: r?.enabled ?? true, dailyRequestLimit: r?.dailyRequestLimit ?? PROVIDERS[id].defaultDailyLimit }];
    }),
  ) as Record<ProviderId, { enabled: boolean; dailyRequestLimit: number }>;
}

export async function usageToday(workspaceId: string, provider: ProviderId) {
  return (await db.providerUsage.findUnique({ where: { workspaceId_provider_day: { workspaceId, provider, day: today() } } }))?.requests ?? 0;
}

export async function recordUsage(workspaceId: string, provider: ProviderId, d: { requests?: number; results?: number; error?: unknown }) {
  const day = today();
  const err = d.error ? describeError(d.error).slice(0, 500) : null;
  const row = await db.providerUsage.upsert({
    where: { workspaceId_provider_day: { workspaceId, provider, day } },
    create: { workspaceId, provider, day, requests: d.requests ?? 0, results: d.results ?? 0, errors: err ? 1 : 0, lastSuccessAt: err ? null : new Date(), lastError: err, lastErrorAt: err ? new Date() : null },
    update: { requests: { increment: d.requests ?? 0 }, results: { increment: d.results ?? 0 }, ...(err ? { errors: { increment: 1 }, lastError: err, lastErrorAt: new Date() } : { lastSuccessAt: new Date() }) },
  });
  await db.providerUsage.update({ where: { id: row.id }, data: { costCents: Math.round(row.requests * PROVIDERS[provider].costPerRequestCents) } });
}

/** Status of every provider for the settings page. */
export async function providerOverview(workspaceId: string) {
  const settings = await providerSettings(workspaceId);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const usage = await db.providerUsage.findMany({ where: { workspaceId, day: { gte: since } }, orderBy: { day: "desc" } });
  return Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const p = PROVIDERS[id];
      const rows = usage.filter((u) => u.provider === id);
      const todayRow = rows.find((u) => u.day === today());
      const lastOk = rows.map((r) => r.lastSuccessAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
      const lastErr = rows.filter((r) => r.lastErrorAt).sort((a, b) => b.lastErrorAt!.getTime() - a.lastErrorAt!.getTime())[0] ?? null;
      const avail = await p.available(workspaceId);
      return {
        id, label: p.label, description: p.description, attribution: p.attribution ?? null,
        enabled: settings[id].enabled, dailyRequestLimit: settings[id].dailyRequestLimit,
        connected: avail.ok, reason: avail.reason ?? null,
        today: { requests: todayRow?.requests ?? 0, results: todayRow?.results ?? 0, errors: todayRow?.errors ?? 0 },
        remainingToday: Math.max(0, settings[id].dailyRequestLimit - (todayRow?.requests ?? 0)),
        last30: { requests: rows.reduce((s, r) => s + r.requests, 0), results: rows.reduce((s, r) => s + r.results, 0), costCents: rows.reduce((s, r) => s + r.costCents, 0) },
        costPerRequestCents: p.costPerRequestCents,
        lastSuccessAt: lastOk, lastError: lastErr?.lastError ?? null, lastErrorAt: lastErr?.lastErrorAt ?? null,
      };
    }),
  );
}
