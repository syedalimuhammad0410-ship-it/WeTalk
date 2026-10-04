import "../guard";
import { AppError, fetchWithTimeout } from "../errors";

export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.businessStatus",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

export type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  googleMapsUri?: string;
};

type SearchBody = {
  textQuery: string;
  pageSize?: number;
  pageToken?: string;
  locationBias?: { circle: { center: { latitude: number; longitude: number }; radius: number } };
  minRating?: number;
  openNow?: boolean;
};

async function placesRequest<T>(apiKey: string, body: SearchBody, fieldMask: string): Promise<T> {
  const res = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
    service: "Google Places API",
    timeoutMs: 20000,
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fieldMask },
    body: JSON.stringify(body),
  });
  let data: (T & { error?: { message?: string; status?: string } }) | null = null;
  try {
    data = await res.json();
  } catch {
    throw new AppError("MALFORMED_RESPONSE", "Google Places API returned an unreadable response.");
  }
  if (!res.ok) {
    const status = data?.error?.status ?? "";
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429 || status === "RESOURCE_EXHAUSTED") throw new AppError("QUOTA_EXCEEDED", `Google Places API quota exceeded. ${msg}`);
    if (res.status === 403 || status === "PERMISSION_DENIED") throw new AppError("INVALID_CREDENTIALS", `Google Places API denied the request — check the API key and that “Places API (New)” is enabled. (${msg})`);
    if (res.status === 401 || status === "UNAUTHENTICATED") throw new AppError("INVALID_CREDENTIALS", `Google Places API key is invalid. (${msg})`);
    if (res.status === 400) throw new AppError("VALIDATION", `Google Places rejected the search: ${msg}`);
    throw new AppError("UPSTREAM_ERROR", `Google Places API error: ${msg}`);
  }
  return data as T;
}

export async function geocodeWithPlaces(apiKey: string, location: string) {
  const r = await placesRequest<{ places?: Place[] }>(apiKey, { textQuery: location, pageSize: 1 }, "places.location,places.formattedAddress");
  const p = r.places?.[0];
  if (!p?.location) throw new AppError("NOT_FOUND", `Could not find the location “${location}”. Try a city and region, e.g. “Mississauga, Ontario”.`);
  return { center: p.location, label: p.formattedAddress ?? location };
}

/** Paginates a Text Search query (Google caps each query at 60 results / 3 pages). */
export async function* searchPlaces(apiKey: string, body: Omit<SearchBody, "pageToken" | "pageSize">, max: number): AsyncGenerator<Place[]> {
  let pageToken: string | undefined;
  let fetched = 0;
  for (let page = 0; page < 3 && fetched < max; page++) {
    const r = await placesRequest<{ places?: Place[]; nextPageToken?: string }>(apiKey, { ...body, pageSize: 20, pageToken }, PLACES_FIELD_MASK);
    const places = r.places ?? [];
    fetched += places.length;
    yield places;
    if (!r.nextPageToken || places.length === 0) break;
    pageToken = r.nextPageToken;
    await new Promise((res) => setTimeout(res, 300));
  }
}

export function placeToBusiness(p: Place) {
  const comp = (type: string) => p.addressComponents?.find((c) => c.types.includes(type));
  return {
    name: p.displayName?.text ?? "Unnamed business",
    category: p.primaryTypeDisplayName?.text ?? p.primaryType?.replace(/_/g, " ") ?? null,
    address: p.formattedAddress ?? null,
    city: comp("locality")?.longText ?? comp("postal_town")?.longText ?? comp("sublocality")?.longText ?? null,
    region: comp("administrative_area_level_1")?.longText ?? null,
    country: comp("country")?.shortText ?? null,
    postalCode: comp("postal_code")?.longText ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    hours: p.regularOpeningHours?.weekdayDescriptions ?? [],
    googleMapsUrl: p.googleMapsUri ?? null,
    operationalStatus: p.businessStatus ?? null,
    source: "GOOGLE_PLACES" as const,
    sourceId: p.id,
    types: [p.primaryType, ...(p.types ?? [])].filter(Boolean) as string[],
  };
}
