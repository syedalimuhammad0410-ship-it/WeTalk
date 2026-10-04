import { route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { storage } from "@/lib/server/storage";
import { aiProvider } from "@/lib/providers/ai";

/** Which providers are live, keyless, or need configuration. */
export const GET = route(async (_req, { user }) => {
  const ctx = await providerContext(user.email);
  const k = ctx.secrets;
  const p = (id: string, label: string, area: string, state: "ready" | "keyless" | "needs-key", envVar?: string, note?: string) => ({ id, label, area, state, envVar, note });
  const ai = aiProvider(ctx);
  return {
    storage: storage().name,
    activeAi: ai.configured() ? (ai.id === "gemini" ? "Gemini" : "Claude") : null,
    providers: [
      p("tesseract", "Tesseract OCR (in-browser)", "OCR", "keyless"),
      p("clip", "CLIP zero-shot scene + embeddings (in-browser, transformers.js)", "Vision", "keyless"),
      p("detr", "Object detection (in-browser, transformers.js)", "Vision", "keyless"),
      p("florence-2", "Florence-2 scene-text OCR + captions (in-browser, WebGPU)", "OCR", "keyless"),
      p("anthropic", `Claude multimodal AI (${ctx.prefs.aiModel})`, "AI", k.ANTHROPIC_API_KEY ? (ctx.prefs.aiEnabled ? "ready" : "needs-key") : "needs-key", "ANTHROPIC_API_KEY", ctx.prefs.aiEnabled ? undefined : "Disabled in settings"),
      p("gemini", "Google Gemini multimodal AI (free tier)", "AI", k.GEMINI_API_KEY ? (ctx.prefs.aiEnabled ? "ready" : "needs-key") : "needs-key", "GEMINI_API_KEY"),
      p("google-cloud-vision", "Google Cloud Vision (OCR, logos, landmarks, web detection)", "Vision", k.GOOGLE_CLOUD_VISION_API_KEY ? "ready" : "needs-key", "GOOGLE_CLOUD_VISION_API_KEY"),
      p("wikidata", "Wikidata knowledge graph", "Knowledge", "keyless"),
      p("wikipedia", "Wikipedia search & summaries", "Web", "keyless"),
      p("duckduckgo", "DuckDuckGo web + news search (whole web; not reachable from Cloudflare)", "Web", "keyless"),
      p("marginalia", "Marginalia independent web search (public API)", "Web", "keyless"),
      p("internet-archive", "Internet Archive (books, newspapers, photos, web history)", "Historical", "keyless"),
      p("brave", "Brave Search API (web/news/images/videos)", "Web", k.BRAVE_SEARCH_API_KEY ? "ready" : "needs-key", "BRAVE_SEARCH_API_KEY"),
      p("tavily", "Tavily Search API", "Web", k.TAVILY_API_KEY ? "ready" : "needs-key", "TAVILY_API_KEY"),
      p("gdelt", "GDELT news index", "News", "keyless"),
      p("youtube", "YouTube Data API (video metadata)", "Videos", k.YOUTUBE_API_KEY ? "ready" : "needs-key", "YOUTUBE_API_KEY"),
      p("loc", "Library of Congress — Chronicling America", "Historical", "keyless"),
      p("osm-nominatim", "OpenStreetMap Nominatim geocoding", "Maps", "keyless"),
      p("osm-overpass", "OpenStreetMap Overpass (nearby landmarks)", "Maps", "keyless"),
      p("photon", "Photon geocoder (second opinion for AI geolocation)", "Maps", "keyless"),
      p("google-maps", "Google Maps Platform (Places, Geocoding)", "Maps", k.GOOGLE_MAPS_API_KEY ? "ready" : "needs-key", "GOOGLE_MAPS_API_KEY"),
      p("esri", "Esri World Imagery satellite tiles", "Maps", "keyless", undefined, "Attribution required; displayed on map"),
      p("wikimedia-commons", "Wikimedia Commons reference photos", "Images", "keyless"),
      p("openverse", "Openverse — 800M+ openly licensed photos (Flickr and more)", "Images", "keyless"),
      p("serpapi-lens", "SerpApi · Google Lens reverse image search", "Images", k.SERPAPI_API_KEY ? "ready" : "needs-key", "SERPAPI_API_KEY"),
    ],
  };
});
