import { z } from "zod";
import { SignJWT } from "jose";
import { HttpError, readJson, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";
import { providerContext } from "@/lib/server/settings";
import { storage } from "@/lib/server/storage";
import { commonsImageSearch, cloudVision, serpApiLens } from "@/lib/providers/vision";
import { makeSource } from "@/lib/server/research";
import { nowIso, uid } from "@/lib/util";
import type { SearchQuery, SearchResult, Source } from "@/lib/types";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("similar"), q: z.string().min(2).max(300) }),
  z.object({ op: z.literal("reverse"), imageKey: z.string().max(200), provider: z.enum(["serpapi-lens", "cloud-vision-web"]) }),
]);

/**
 * ImageSearchProvider operations. Reverse image search uses only legitimate APIs
 * (Google Cloud Vision web detection, SerpApi Google Lens); without keys it reports
 * that the provider is not configured instead of pretending.
 */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, Body);
  const ctx = await providerContext(user.email);
  const query: SearchQuery = { id: uid("q"), branch: "reverse-image", text: "", kind: b.op === "similar" ? "images" : "reverse-image", provider: "", status: "pending", resultCount: 0, createdAt: nowIso() };
  const sources: Source[] = [];
  const results: SearchResult[] = [];
  if (b.op === "similar") {
    query.text = b.q;
    query.provider = commonsImageSearch.id;
    const r = await commonsImageSearch.findSimilarImages(b.q, 10);
    query.status = r.status;
    query.resultCount = r.items.length;
    query.error = r.error;
    for (const im of r.items) {
      const s = makeSource({ title: im.title, url: im.url, provider: "wikimedia-commons", publisher: "Wikimedia Commons", category: "images", type: "image", excerpt: im.license || "" });
      sources.push(s);
      results.push({ id: uid("r"), queryId: query.id, title: im.title, url: im.url, snippet: im.license || "", thumbnail: im.thumb, sourceId: s.id });
    }
    return { queries: [query], results, sources };
  }
  if (!ownsImageKey(user.email, b.imageKey)) throw new HttpError(404, "Image not found.");
  query.text = "Reverse image search of uploaded image";
  if (b.provider === "serpapi-lens") {
    query.provider = "serpapi-lens";
    const lens = serpApiLens(ctx);
    if (!lens.configured()) {
      query.status = "not_configured";
      query.error = "SerpApi Google Lens requires SERPAPI_API_KEY. (Google Lens itself has no public API; TRACE does not scrape it.)";
      return { queries: [query], results, sources };
    }
    const token = await new SignJWT({ key: b.imageKey })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("trace")
      .setAudience("trace-public-image")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    const origin = process.env.URL || req.nextUrl.origin;
    const r = await lens.reverseSearch!(`${origin}/api/public-image/${token}`);
    query.status = r.status;
    query.resultCount = r.items.length;
    query.error = r.error;
    for (const m of r.items) {
      const s = makeSource({ title: m.title, url: m.url, provider: "serpapi-lens", category: "images", type: "webpage", excerpt: m.snippet || "Visual match", reliability: { tier: "tertiary", note: "Visual match from a third-party reverse image search; a visual match is not proof of location." } });
      sources.push(s);
      results.push({ id: uid("r"), queryId: query.id, title: m.title, url: m.url, snippet: m.snippet || "", thumbnail: m.thumb, sourceId: s.id });
    }
    return { queries: [query], results, sources };
  }
  query.provider = "google-cloud-vision";
  const bin = await storage().getBinary(b.imageKey);
  if (!bin) throw new HttpError(404, "Image not found.");
  const cv = await cloudVision(ctx, Buffer.from(bin.data).toString("base64"), 0, 0, ["WEB_DETECTION"]);
  query.status = cv.status === "ok" ? (cv.web.pages.length ? "ok" : "empty") : cv.status;
  query.error = cv.error;
  query.resultCount = cv.web.pages.length;
  for (const p of cv.web.pages.slice(0, 15)) {
    const s = makeSource({ title: p.title, url: p.url, provider: "google-cloud-vision", category: "images", excerpt: "Page containing a matching image (Cloud Vision web detection).", reliability: { tier: "tertiary", note: "Web page reported to contain a matching or partially matching image." } });
    sources.push(s);
    results.push({ id: uid("r"), queryId: query.id, title: p.title, url: p.url, snippet: s.excerpt, sourceId: s.id });
  }
  return { queries: [query], results, sources, webEntities: cv.web.entities.slice(0, 10), bestGuess: cv.web.bestGuess };
}, { limit: 20, name: "image-search" });
