import type { SourceCategory } from "@/lib/types";

export type ProviderStatus = "ok" | "empty" | "error" | "not_configured";

export interface ProviderResult<T> {
  provider: string;
  status: ProviderStatus;
  items: T[];
  error?: string;
  cached?: boolean;
  ms?: number;
}

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
  publisher?: string;
  publishedAt?: string;
  thumbnail?: string;
  category?: SourceCategory;
}

export interface ImageHit {
  title: string;
  url: string; // page URL (attribution)
  imageUrl: string; // full/large image
  thumb: string;
  license?: string;
  author?: string;
  width?: number;
  height?: number;
}

export interface PlaceHit {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  kind: string;
  address?: string;
  osmRef?: string;
  placeId?: string;
  url: string;
  wikidataId?: string;
  importance?: number;
}

// ---- Provider interfaces (pluggable; see docs/ARCHITECTURE.md) ----

export interface SearchProvider {
  id: string;
  label: string;
  configured(): boolean;
  searchWeb?(q: string, n?: number): Promise<ProviderResult<WebHit>>;
  searchNews?(q: string, n?: number): Promise<ProviderResult<WebHit>>;
  searchVideos?(q: string, n?: number): Promise<ProviderResult<WebHit>>;
  searchImages?(q: string, n?: number): Promise<ProviderResult<ImageHit>>;
}

export interface MapProvider {
  id: string;
  label: string;
  configured(): boolean;
  geocode(q: string, n?: number): Promise<ProviderResult<PlaceHit>>;
  reverse(lat: number, lng: number): Promise<ProviderResult<PlaceHit>>;
  searchPlaces(q: string, near?: { lat: number; lng: number; radiusKm?: number }, n?: number): Promise<ProviderResult<PlaceHit>>;
  nearby?(lat: number, lng: number, radiusM?: number): Promise<ProviderResult<PlaceHit>>;
}

export interface ImageSearchProvider {
  id: string;
  label: string;
  configured(): boolean;
  /** Reverse search requires a publicly reachable image URL. */
  reverseSearch?(publicImageUrl: string): Promise<ProviderResult<ImageHit & { snippet?: string }>>;
  findSimilarImages(q: string, n?: number): Promise<ProviderResult<ImageHit>>;
}

export function wrapError<T>(provider: string, e: unknown): ProviderResult<T> {
  return { provider, status: "error", items: [], error: e instanceof Error ? e.message : String(e) };
}

export function notConfigured<T>(provider: string, envVar: string): ProviderResult<T> {
  return { provider, status: "not_configured", items: [], error: `${provider} is not configured. Set ${envVar} (see Settings → API keys).` };
}
