// Request/response payloads exchanged between the investigation runner (client)
// and research workers (server). Everything returned is mergeable into an Investigation.
import type {
  Dossier,
  Candidate,
  Contradiction,
  Entity,
  GeoLocation,
  SearchQuery,
  SearchResult,
  Source,
  TimelineEvent,
} from "@/lib/types";

export interface ResearchDelta {
  queries: SearchQuery[];
  results: SearchResult[];
  sources: Source[];
  entities?: Entity[];
  candidates?: Candidate[];
  dossiers?: Dossier[];
  locations?: GeoLocation[];
  timeline?: TimelineEvent[];
  contradictions?: Contradiction[];
  notes?: string[];
  providerWarnings?: string[];
}

export interface TextInput {
  text: string;
  confidence: number; // 0..100
  origin: "ocr" | "ai" | "cloud-vision" | "user" | "logo";
  clueId?: string;
}

export interface EntityRequest {
  texts: TextInput[];
  sceneHints: string[]; // e.g. "basketball", "hotel"
  aiEntities?: { name: string; type: string }[];
  logos?: { name: string; confidence: number; clueId?: string }[];
  landmarks?: { name: string; lat?: number; lng?: number; score: number }[];
  mode: string;
  maxLookups?: number;
  officialOnly?: boolean;
}

export interface CandidateRequest {
  entities: { id: string; name: string; type: string; wikidataId?: string; matchQuality: string }[];
  texts: TextInput[];
  sceneHints: string[];
  exif?: { lat?: number; lng?: number; takenAt?: string };
  landmarks?: { name: string; lat?: number; lng?: number; score: number }[];
  mode: string;
  maxCandidates?: number;
}

export interface VerifyRequest {
  candidates: { id: string; name: string; city?: string; kind: string; activeFrom?: string; activeTo?: string; teamName?: string }[];
  yearHint?: number;
  mode: string;
  kinds: ("web" | "news" | "videos" | "history")[];
}

export interface SearchRequest {
  kind: "web" | "news" | "videos" | "images" | "history" | "knowledge";
  query: string;
  branch: string;
  officialOnly?: boolean;
  userAdded?: boolean;
}
