import "server-only";
import { fetchJson } from "@/lib/server/http";
import type { ProviderContext } from "@/lib/server/settings";
import { notConfigured, wrapError, type ImageHit, type ImageSearchProvider, type ProviderResult } from "./types";
import { commonsImages } from "./search";

type V = { x?: number; y?: number };
interface Annot {
  textAnnotations?: { description: string; boundingPoly?: { vertices: V[] } }[];
  logoAnnotations?: { description: string; score: number; mid?: string; boundingPoly?: { vertices: V[] } }[];
  landmarkAnnotations?: { description: string; score: number; mid?: string; locations?: { latLng: { latitude: number; longitude: number } }[] }[];
  labelAnnotations?: { description: string; score: number }[];
  webDetection?: {
    webEntities?: { entityId?: string; description?: string; score?: number }[];
    pagesWithMatchingImages?: { url: string; pageTitle?: string }[];
    visuallySimilarImages?: { url: string }[];
    bestGuessLabels?: { label: string }[];
  };
  error?: { message: string };
}

export interface CloudVisionResult {
  provider: "google-cloud-vision";
  status: "ok" | "error" | "not_configured";
  error?: string;
  text: { text: string; box?: { x: number; y: number; w: number; h: number } }[];
  logos: { name: string; score: number; box?: { x: number; y: number; w: number; h: number } }[];
  landmarks: { name: string; score: number; lat?: number; lng?: number }[];
  labels: { name: string; score: number }[];
  web: { entities: { name: string; score: number }[]; pages: { url: string; title: string }[]; similar: string[]; bestGuess: string[] };
}

function toBox(vs: V[] | undefined, w: number, h: number) {
  if (!vs?.length || !w || !h) return undefined;
  const xs = vs.map((v) => v.x || 0);
  const ys = vs.map((v) => v.y || 0);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: x / w, y: y / h, w: (Math.max(...xs) - x) / w, h: (Math.max(...ys) - y) / h };
}

/** Google Cloud Vision: OCR, logo, landmark, label and web detection (legitimate reverse-image signals). */
export async function cloudVision(ctx: ProviderContext, base64: string, width: number, height: number, features = ["TEXT_DETECTION", "LOGO_DETECTION", "LANDMARK_DETECTION", "LABEL_DETECTION", "WEB_DETECTION"]): Promise<CloudVisionResult> {
  const empty = { text: [], logos: [], landmarks: [], labels: [], web: { entities: [], pages: [], similar: [], bestGuess: [] } };
  const key = ctx.secrets.GOOGLE_CLOUD_VISION_API_KEY;
  if (!key) return { provider: "google-cloud-vision", status: "not_configured", error: "Set GOOGLE_CLOUD_VISION_API_KEY to enable Google Cloud Vision.", ...empty };
  try {
    const { data } = await fetchJson<{ responses: Annot[] }>(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      provider: "google-cloud-vision",
      op: "annotate",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: features.map((type) => ({ type, maxResults: 15 })) }] }),
      timeoutMs: 15000,
      cacheTtl: 86400 * 7,
      costUnits: features.length,
    });
    const r = data.responses?.[0] || {};
    if (r.error) throw new Error(r.error.message);
    return {
      provider: "google-cloud-vision",
      status: "ok",
      text: (r.textAnnotations || []).slice(1).map((t) => ({ text: t.description, box: toBox(t.boundingPoly?.vertices, width, height) })),
      logos: (r.logoAnnotations || []).map((l) => ({ name: l.description, score: l.score, box: toBox(l.boundingPoly?.vertices, width, height) })),
      landmarks: (r.landmarkAnnotations || []).map((l) => ({ name: l.description, score: l.score, lat: l.locations?.[0]?.latLng.latitude, lng: l.locations?.[0]?.latLng.longitude })),
      labels: (r.labelAnnotations || []).map((l) => ({ name: l.description, score: l.score })),
      web: {
        entities: (r.webDetection?.webEntities || []).filter((e) => e.description).map((e) => ({ name: e.description!, score: e.score || 0 })),
        pages: (r.webDetection?.pagesWithMatchingImages || []).map((p) => ({ url: p.url, title: (p.pageTitle || p.url).replace(/<[^>]+>/g, "") })),
        similar: (r.webDetection?.visuallySimilarImages || []).map((s) => s.url),
        bestGuess: (r.webDetection?.bestGuessLabels || []).map((b) => b.label),
      },
    };
  } catch (e) {
    return { provider: "google-cloud-vision", status: "error", error: e instanceof Error ? e.message : String(e), ...empty };
  }
}

/** Wikimedia Commons — keyless, licensed reference photos for candidates. */
export const commonsImageSearch: ImageSearchProvider = {
  id: "wikimedia-commons",
  label: "Wikimedia Commons",
  configured: () => true,
  findSimilarImages: (q, n) => commonsImages(q, n),
};

/** SerpApi Google Lens — legitimate third-party API for reverse image search (needs a public URL). */
export function serpApiLens(ctx: ProviderContext): ImageSearchProvider {
  const key = ctx.secrets.SERPAPI_API_KEY;
  return {
    id: "serpapi-lens",
    label: "SerpApi · Google Lens",
    configured: () => Boolean(key),
    async reverseSearch(publicUrl): Promise<ProviderResult<ImageHit & { snippet?: string }>> {
      if (!key) return notConfigured("serpapi-lens", "SERPAPI_API_KEY");
      try {
        const { data, cached, ms } = await fetchJson<{
          visual_matches?: { title: string; link: string; source?: string; thumbnail?: string; image?: string }[];
          error?: string;
        }>(`https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(publicUrl)}&api_key=${key}`, {
          provider: "serpapi-lens",
          op: "reverse",
          timeoutMs: 20000,
          cacheTtl: 86400,
          costUnits: 1,
        });
        if (data.error) throw new Error(data.error);
        const items = (data.visual_matches || []).slice(0, 20).map((m) => ({
          title: m.title,
          url: m.link,
          imageUrl: m.image || m.thumbnail || "",
          thumb: m.thumbnail || "",
          snippet: m.source,
        }));
        return { provider: "serpapi-lens", status: items.length ? "ok" : "empty", items, cached, ms };
      } catch (e) {
        return wrapError("serpapi-lens", e);
      }
    },
    findSimilarImages: (q, n) => commonsImages(q, n),
  };
}
