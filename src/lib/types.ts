// Core domain model for TRACE investigations.
// The investigation document is the aggregate root; every collection below maps
// 1:1 to a relational table in db/schema.sql (see docs/ARCHITECTURE.md).

export type InvestigationMode =
  | "quick"
  | "deep"
  | "visual"
  | "location"
  | "document"
  | "sports"
  | "building"
  | "historical"
  | "custom";

export type Confidence = "high" | "moderate" | "low" | "insufficient";
export type EvidenceKind = "direct" | "indirect" | "inference" | "user";
export type Strength = "strong" | "moderate" | "weak";

/** Normalised (0..1) rectangle relative to image width/height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExifInfo {
  lat?: number;
  lng?: number;
  takenAt?: string;
  make?: string;
  model?: string;
  software?: string;
  orientation?: number;
}

export interface OcrLine {
  id: string;
  text: string;
  /** 0..100 as reported by the OCR engine. */
  confidence: number;
  box?: Box;
  /** Which pixels the text was read from. Enhanced reads are never silently merged. */
  source: "original" | "enhanced" | "region" | "ai";
  engine: string;
  uncertain: boolean;
  corrections?: string[];
}

export interface SceneLabel {
  label: string;
  score: number;
  group: string;
}

export interface DetectedObject {
  label: string;
  score: number;
  box: Box;
}

export interface ImageAnalysis {
  analyzedAt: string;
  engines: string[];
  scene: SceneLabel[];
  objects: DetectedObject[];
  ocr: OcrLine[];
  colors: { hex: string; share: number }[];
  brightness: number;
  skyShare: number;
  indoorLikely: boolean | null;
  exif?: ExifInfo;
  ai?: AiVisionResult;
  aiError?: string;
  warnings: string[];
}

export interface ImageRecord {
  id: string;
  name: string;
  /** Storage key for the binary (served via /api/images/[key]). */
  key: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  sha256: string;
  createdAt: string;
  enhancedFrom?: string;
  enhancements?: string[];
  demoSource?: { title: string; url: string; license: string; author?: string };
  analysis?: ImageAnalysis;
}

export interface ImageRegion {
  id: string;
  imageId: string;
  box: Box;
  label: string;
  createdAt: string;
}

export type ClueType =
  | "text"
  | "logo"
  | "scene"
  | "object"
  | "architecture"
  | "environment"
  | "document"
  | "exif"
  | "sport"
  | "date"
  | "address"
  | "phone"
  | "website"
  | "flag"
  | "user";

export interface Clue {
  id: string;
  imageId?: string;
  regionId?: string;
  type: ClueType;
  label: string;
  value: string;
  /** Internal 0..1 signal strength, never shown as a percentage. */
  weight: number;
  box?: Box;
  origin: "ocr" | "vision-model" | "detector" | "exif" | "ai" | "user" | "heuristic";
  engine: string;
  ignored?: boolean;
}

export type EntityType =
  | "organization"
  | "sports_team"
  | "venue"
  | "building"
  | "city"
  | "country"
  | "region"
  | "address"
  | "event"
  | "date"
  | "product"
  | "website"
  | "publication"
  | "brand"
  | "place"
  | "public_figure"
  | "other";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  wikidataId?: string;
  description?: string;
  detectedBecause: string[];
  clueIds: string[];
  sourceIds: string[];
  locationIds: string[];
  matchQuality: Strength;
}

export type SourceCategory =
  | "official"
  | "maps"
  | "news"
  | "sports"
  | "images"
  | "videos"
  | "government"
  | "reference"
  | "user"
  | "other";

export interface Source {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
  accessedAt: string;
  excerpt: string;
  supports: string[];
  category: SourceCategory;
  type: "api-record" | "webpage" | "image" | "video" | "dataset" | "article" | "map";
  provider: string;
  reliability: { tier: "primary" | "secondary" | "tertiary" | "user"; note: string };
  usedInReasoning: boolean;
  /** True only if TRACE itself retrieved this record from the provider. */
  verified: boolean;
  saved?: boolean;
  why?: string;
}

export type QueryKind = "web" | "news" | "videos" | "images" | "maps" | "knowledge" | "history" | "reverse-image";

export interface SearchQuery {
  id: string;
  branch: string;
  text: string;
  kind: QueryKind;
  provider: string;
  status: "pending" | "ok" | "empty" | "error" | "not_configured" | "skipped";
  resultCount: number;
  error?: string;
  createdAt: string;
  durationMs?: number;
  cached?: boolean;
  userAdded?: boolean;
}

export interface SearchResult {
  id: string;
  queryId: string;
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
  sourceId?: string;
  publishedAt?: string;
}

export interface GeoLocation {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  kind: string;
  wikidataId?: string;
  osmRef?: string;
  sourceIds: string[];
  userSelected?: boolean;
}

export interface CandidateImage {
  id: string;
  url: string;
  thumb: string;
  title: string;
  sourceId: string;
  license?: string;
  /** Filled after a real pixel comparison. */
  comparison?: VisualComparison;
}

export interface VisualComparison {
  comparedAt: string;
  method: string[];
  embedding?: number;
  color?: number;
  structure?: number;
  overall: Strength | "none";
  cells?: { box: Box; score: number }[];
  notes: string[];
}

export interface CandidateSignals {
  text: number | null;
  logo: number | null;
  visual: number | null;
  geo: number | null;
  temporal: number | null;
  source: number | null;
  exif: number | null;
  link: number | null;
  /** AI geolocation estimate (0..1), already discounted when map data could not confirm it */
  ai?: number | null;
}

export interface Candidate {
  id: string;
  name: string;
  kind: string;
  wikidataId?: string;
  locationId?: string;
  city?: string;
  region?: string;
  country?: string;
  address?: string;
  description?: string;
  names: { name: string; from?: string; to?: string }[];
  activeFrom?: string;
  activeTo?: string;
  inception?: string;
  why: string[];
  against: string[];
  evidenceIds: string[];
  sourceIds: string[];
  signals: CandidateSignals;
  confidence: Confidence;
  confidenceReasons: string[];
  status: "active" | "leading" | "rejected";
  rejectionReason?: string;
  images: CandidateImage[];
  derivedFrom: string[];
  commonsCategory?: string;
  falsification?: { question: string; result: string; outcome: "passed" | "failed" | "inconclusive" }[];
}

export interface Evidence {
  id: string;
  candidateId?: string;
  kind: EvidenceKind;
  polarity: "supports" | "contradicts" | "neutral";
  statement: string;
  strength: Strength;
  sourceIds: string[];
  clueIds: string[];
  createdAt: string;
}

export interface Contradiction {
  id: string;
  subject: string;
  property: string;
  claims: { value: string; sourceId: string }[];
  note: string;
}

export interface TimelineEvent {
  id: string;
  date: string;
  year: number;
  label: string;
  kind: "construction" | "opening" | "renaming" | "tenancy" | "closure" | "event" | "photo" | "publication" | "user" | "other";
  candidateId?: string;
  entityId?: string;
  sourceIds: string[];
  userProvided?: boolean;
}

export interface BoardNodeData {
  title: string;
  subtitle?: string;
  kind: "image" | "clue" | "entity" | "location" | "candidate" | "source" | "query" | "timeline" | "note" | "conclusion" | "map" | "video";
  refId?: string;
  thumb?: string;
  color?: string;
  pinned?: boolean;
  note?: string;
  group?: string;
  [key: string]: unknown;
}

export interface BoardNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: BoardNodeData;
  hidden?: boolean;
}

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  manual?: boolean;
  kind?: "supports" | "contradicts" | "relates" | "string";
}

export interface Board {
  id: string;
  name: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
  updatedAt: string;
}

export interface ChatAction {
  type: string;
  label: string;
  payload?: Record<string, unknown>;
  status?: "proposed" | "done" | "cancelled" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  actions?: ChatAction[];
  sourceIds?: string[];
  engine?: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
  tags: string[];
  /** Extracted year hint, used as user-provided (unverified) context. */
  yearHint?: number;
}

export interface RunStep {
  id: string;
  branch: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface InvestigationRun {
  id: string;
  mode: InvestigationMode;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "complete" | "error" | "cancelled";
  steps: RunStep[];
  budget: { maxQueries: number; used: number };
  focus?: string;
  error?: string;
}

export interface Conclusion {
  candidateId: string | null;
  headline: string;
  confidence: Confidence;
  reasons: string[];
  uncertainties: string[];
  explanation: string;
  generatedBy: "rules" | "ai";
  createdAt: string;
  nextSteps: string[];
}

export interface InvestigationFocus {
  imageId?: string;
  regionId?: string;
  clueTypes?: ClueType[];
  instruction?: string;
  officialOnly?: boolean;
}

export interface Investigation {
  id: string;
  ownerEmail: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: InvestigationMode;
  customInstructions?: string;
  status: "draft" | "running" | "complete" | "error";
  demo?: boolean;
  focus?: InvestigationFocus;
  images: ImageRecord[];
  regions: ImageRegion[];
  clues: Clue[];
  entities: Entity[];
  candidates: Candidate[];
  locations: GeoLocation[];
  evidence: Evidence[];
  sources: Source[];
  queries: SearchQuery[];
  results: SearchResult[];
  timeline: TimelineEvent[];
  contradictions: Contradiction[];
  chat: ChatMessage[];
  notes: Note[];
  boards: Board[];
  runs: InvestigationRun[];
  conclusion?: Conclusion;
}

export interface InvestigationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: InvestigationMode;
  status: Investigation["status"];
  thumbKey?: string;
  imageCount: number;
  candidateCount: number;
  sourceCount: number;
  headline?: string;
  confidence?: Confidence;
  demo?: boolean;
}

// ---------- AI provider structured outputs ----------

export interface AiVisionResult {
  model: string;
  summary: string;
  sceneType: string;
  text: { text: string; where: string; confidence: "high" | "medium" | "low" }[];
  logos: { name: string; category: string; confidence: "high" | "medium" | "low"; alternatives: string[] }[];
  architecture: string[];
  environment: string[];
  sport?: { sport: string; features: string[] } | null;
  document?: { publication?: string; date?: string; headline?: string; names: string[] } | null;
  entities: { name: string; type: string }[];
  suggestedQueries: string[];
  flags?: { country: string; confidence: "high" | "medium" | "low" }[];
  peopleNote?: string;
}
