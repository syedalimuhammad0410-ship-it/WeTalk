import "server-only";
import { fetchJson } from "@/lib/server/http";
import type { ProviderContext } from "@/lib/server/settings";
import { hostOf } from "@/lib/util";
import { notConfigured, wrapError, type ImageHit, type ProviderResult, type SearchProvider, type WebHit } from "./types";

const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#039;/g, "'").trim();
const DAY = 86400;

// ---------------- Wikipedia (keyless) ----------------
export const wikipedia: SearchProvider = {
  id: "wikipedia",
  label: "Wikipedia",
  configured: () => true,
  async searchWeb(q, n = 6) {
    try {
      const u = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${n}&srprop=snippet|timestamp&srsearch=${encodeURIComponent(q)}`;
      const { data, cached, ms } = await fetchJson<{ query?: { search: { title: string; snippet: string; timestamp: string }[] } }>(u, {
        provider: "wikipedia",
        op: "search",
        cacheTtl: 3 * DAY,
      });
      const items: WebHit[] = (data.query?.search || []).map((r) => ({
        title: r.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
        snippet: strip(r.snippet),
        publisher: "Wikipedia",
        publishedAt: r.timestamp,
        category: "reference",
      }));
      return { provider: "wikipedia", status: items.length ? "ok" : "empty", items, cached, ms };
    } catch (e) {
      return wrapError("wikipedia", e);
    }
  },
};

export async function wikipediaSummary(title: string): Promise<{ title: string; extract: string; url: string; thumb?: string } | null> {
  try {
    const u = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const { data } = await fetchJson<{ title: string; extract: string; content_urls?: { desktop?: { page: string } }; thumbnail?: { source: string } }>(u, {
      provider: "wikipedia",
      op: "summary",
      cacheTtl: 7 * DAY,
    });
    return { title: data.title, extract: data.extract, url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, thumb: data.thumbnail?.source };
  } catch {
    return null;
  }
}

// ---------------- GDELT news (keyless) ----------------
export const gdelt: SearchProvider = {
  id: "gdelt",
  label: "GDELT news index",
  configured: () => true,
  async searchNews(q, n = 8) {
    try {
      const query = q.split(/\s+/).filter((w) => w.length >= 3).join(" ");
      if (query.length < 4) return { provider: "gdelt", status: "empty", items: [] };
      const u = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${n}&sort=hybridrel`;
      const { data, cached, ms } = await fetchJson<{ articles?: { url: string; title: string; seendate: string; domain: string; socialimage?: string }[] }>(u, {
        provider: "gdelt",
        op: "news",
        cacheTtl: DAY,
        timeoutMs: 9000,
      });
      const items: WebHit[] = (data.articles || []).map((a) => ({
        title: a.title,
        url: a.url,
        snippet: `Indexed by GDELT from ${a.domain}`,
        publisher: a.domain,
        publishedAt: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : undefined,
        thumbnail: a.socialimage,
        category: "news",
      }));
      return { provider: "gdelt", status: items.length ? "ok" : "empty", items, cached, ms };
    } catch (e) {
      return wrapError("gdelt", e);
    }
  },
};

// ---------------- Library of Congress (keyless, historical newspapers) ----------------
export async function searchHistoricalNewspapers(q: string, n = 8): Promise<ProviderResult<WebHit>> {
  try {
    const u = `https://www.loc.gov/collections/chronicling-america/?q=${encodeURIComponent(q)}&fo=json&c=${n}`;
    const { data, cached, ms } = await fetchJson<{ results?: { title: string; url: string; date?: string; description?: string[]; image_url?: string[]; partof_title?: string[] }[] }>(u, {
      provider: "loc",
      op: "chronicling-america",
      cacheTtl: 7 * DAY,
      timeoutMs: 9000,
    });
    const items: WebHit[] = (data.results || []).slice(0, n).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: strip((r.description || []).join(" ")).slice(0, 300),
      publisher: "Library of Congress — Chronicling America",
      publishedAt: r.date,
      thumbnail: r.image_url?.[0],
      category: "government",
    }));
    return { provider: "loc", status: items.length ? "ok" : "empty", items, cached, ms };
  } catch (e) {
    return wrapError("loc", e);
  }
}

// ---------------- Wikimedia Commons images (keyless) ----------------
interface CommonsPage {
  title: string;
  imageinfo?: { url: string; thumburl?: string; descriptionurl: string; width: number; height: number; extmetadata?: Record<string, { value: string }> }[];
}

export async function commonsImages(q: string, n = 8, opts: { category?: string } = {}): Promise<ProviderResult<ImageHit>> {
  try {
    const gen = opts.category
      ? `generator=categorymembers&gcmtype=file&gcmlimit=${n}&gcmtitle=${encodeURIComponent("Category:" + opts.category)}`
      : `generator=search&gsrnamespace=6&gsrlimit=${n}&gsrsearch=${encodeURIComponent(q + " filetype:bitmap")}`;
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&${gen}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=640`;
    const { data, cached, ms } = await fetchJson<{ query?: { pages?: Record<string, CommonsPage> } }>(u, { provider: "wikimedia-commons", op: "images", cacheTtl: 7 * DAY });
    const items: ImageHit[] = Object.values(data.query?.pages || {})
      .filter((p) => p.imageinfo?.[0] && /\.(jpe?g|png|webp)$/i.test(p.title))
      .map((p) => {
        const ii = p.imageinfo![0];
        const m = ii.extmetadata || {};
        return {
          title: p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
          url: ii.descriptionurl,
          imageUrl: ii.thumburl || ii.url,
          thumb: ii.thumburl || ii.url,
          license: m.LicenseShortName?.value,
          author: m.Artist?.value ? strip(m.Artist.value).slice(0, 80) : undefined,
          width: ii.width,
          height: ii.height,
        };
      });
    return { provider: "wikimedia-commons", status: items.length ? "ok" : "empty", items, cached, ms };
  } catch (e) {
    return wrapError("wikimedia-commons", e);
  }
}

export async function commonsFileInfo(fileTitle: string) {
  const r = await fetchJson<{ query?: { pages?: Record<string, CommonsPage> } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent("File:" + fileTitle.replace(/^File:/, ""))}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600`,
    { provider: "wikimedia-commons", op: "fileinfo", cacheTtl: 30 * DAY },
  );
  const p = Object.values(r.data.query?.pages || {})[0];
  const ii = p?.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata || {};
  return {
    title: p.title,
    url: ii.descriptionurl,
    imageUrl: ii.thumburl || ii.url,
    license: m.LicenseShortName?.value || "see source",
    author: m.Artist?.value ? strip(m.Artist.value).slice(0, 120) : undefined,
    description: m.ImageDescription?.value ? strip(m.ImageDescription.value).slice(0, 400) : undefined,
    date: m.DateTimeOriginal?.value ? strip(m.DateTimeOriginal.value) : undefined,
  };
}

// ---------------- Brave Search (API key) ----------------
export function brave(ctx: ProviderContext): SearchProvider {
  const key = ctx.secrets.BRAVE_SEARCH_API_KEY;
  const call = async <T>(path: string, q: string, n: number, op: string) =>
    fetchJson<T>(`https://api.search.brave.com/res/v1/${path}?q=${encodeURIComponent(q)}&count=${n}`, {
      provider: "brave",
      op,
      headers: { "X-Subscription-Token": key!, Accept: "application/json" },
      cacheTtl: DAY,
      costUnits: 1,
    });
  type R = { title: string; url: string; description?: string; age?: string; page_age?: string; thumbnail?: { src: string }; meta_url?: { hostname: string }; properties?: { url: string } };
  return {
    id: "brave",
    label: "Brave Search API",
    configured: () => Boolean(key),
    async searchWeb(q, n = 8) {
      if (!key) return notConfigured("brave", "BRAVE_SEARCH_API_KEY");
      try {
        const { data, cached, ms } = await call<{ web?: { results: R[] } }>("web/search", q, n, "web");
        const items = (data.web?.results || []).map((r) => ({ title: strip(r.title), url: r.url, snippet: strip(r.description || ""), publisher: hostOf(r.url), publishedAt: r.page_age, thumbnail: r.thumbnail?.src }));
        return { provider: "brave", status: items.length ? "ok" : "empty", items, cached, ms };
      } catch (e) {
        return wrapError("brave", e);
      }
    },
    async searchNews(q, n = 8) {
      if (!key) return notConfigured("brave", "BRAVE_SEARCH_API_KEY");
      try {
        const { data, cached, ms } = await call<{ results?: R[] }>("news/search", q, n, "news");
        const items = (data.results || []).map((r) => ({ title: strip(r.title), url: r.url, snippet: strip(r.description || ""), publisher: r.meta_url?.hostname || hostOf(r.url), publishedAt: r.page_age || r.age, thumbnail: r.thumbnail?.src, category: "news" as const }));
        return { provider: "brave", status: items.length ? "ok" : "empty", items, cached, ms };
      } catch (e) {
        return wrapError("brave", e);
      }
    },
    async searchVideos(q, n = 8) {
      if (!key) return notConfigured("brave", "BRAVE_SEARCH_API_KEY");
      try {
        const { data, cached, ms } = await call<{ results?: R[] }>("videos/search", q, n, "videos");
        const items = (data.results || []).map((r) => ({ title: strip(r.title), url: r.url, snippet: strip(r.description || ""), publisher: hostOf(r.url), publishedAt: r.page_age || r.age, thumbnail: r.thumbnail?.src, category: "videos" as const }));
        return { provider: "brave", status: items.length ? "ok" : "empty", items, cached, ms };
      } catch (e) {
        return wrapError("brave", e);
      }
    },
    async searchImages(q, n = 8) {
      if (!key) return notConfigured("brave", "BRAVE_SEARCH_API_KEY");
      try {
        const { data, cached, ms } = await call<{ results?: R[] }>("images/search", q, n, "images");
        const items: ImageHit[] = (data.results || []).map((r) => ({ title: strip(r.title), url: r.url, imageUrl: r.properties?.url || r.thumbnail?.src || "", thumb: r.thumbnail?.src || "" }));
        return { provider: "brave", status: items.length ? "ok" : "empty", items, cached, ms };
      } catch (e) {
        return wrapError("brave", e);
      }
    },
  };
}

// ---------------- Tavily (API key) ----------------
export function tavily(ctx: ProviderContext): SearchProvider {
  const key = ctx.secrets.TAVILY_API_KEY;
  const run = async (q: string, n: number, topic: "general" | "news") => {
    const { data, cached, ms } = await fetchJson<{ results?: { title: string; url: string; content: string; published_date?: string }[] }>("https://api.tavily.com/search", {
      provider: "tavily",
      op: topic,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: q, max_results: n, topic, search_depth: "basic" }),
      cacheTtl: DAY,
      costUnits: 1,
      timeoutMs: 12000,
    });
    const items: WebHit[] = (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 400), publisher: hostOf(r.url), publishedAt: r.published_date, category: topic === "news" ? "news" : undefined }));
    return { provider: "tavily", status: items.length ? ("ok" as const) : ("empty" as const), items, cached, ms };
  };
  return {
    id: "tavily",
    label: "Tavily Search API",
    configured: () => Boolean(key),
    async searchWeb(q, n = 8) {
      if (!key) return notConfigured("tavily", "TAVILY_API_KEY");
      try {
        return await run(q, n, "general");
      } catch (e) {
        return wrapError("tavily", e);
      }
    },
    async searchNews(q, n = 8) {
      if (!key) return notConfigured("tavily", "TAVILY_API_KEY");
      try {
        return await run(q, n, "news");
      } catch (e) {
        return wrapError("tavily", e);
      }
    },
  };
}

// ---------------- YouTube Data API (API key) ----------------
export function youtube(ctx: ProviderContext): SearchProvider {
  const key = ctx.secrets.YOUTUBE_API_KEY;
  return {
    id: "youtube",
    label: "YouTube Data API",
    configured: () => Boolean(key),
    async searchVideos(q, n = 8) {
      if (!key) return notConfigured("youtube", "YOUTUBE_API_KEY");
      try {
        const { data, cached, ms } = await fetchJson<{
          items?: { id: { videoId: string }; snippet: { title: string; description: string; publishedAt: string; channelTitle: string; thumbnails?: { medium?: { url: string } } } }[];
        }>(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${n}&q=${encodeURIComponent(q)}&key=${key}`, {
          provider: "youtube",
          op: "search",
          cacheTtl: DAY,
          costUnits: 100,
        });
        const items: WebHit[] = (data.items || []).map((v) => ({
          title: strip(v.snippet.title),
          url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
          snippet: strip(v.snippet.description),
          publisher: `YouTube · ${v.snippet.channelTitle}`,
          publishedAt: v.snippet.publishedAt,
          thumbnail: v.snippet.thumbnails?.medium?.url,
          category: "videos",
        }));
        return { provider: "youtube", status: items.length ? "ok" : "empty", items, cached, ms };
      } catch (e) {
        return wrapError("youtube", e);
      }
    },
  };
}

/** Picks the configured web provider (falls back to keyless Wikipedia). */
export function webProviders(ctx: ProviderContext): SearchProvider[] {
  const b = brave(ctx);
  const t = tavily(ctx);
  const pref = ctx.prefs.webProvider;
  const list: SearchProvider[] = [];
  if ((pref === "auto" || pref === "brave") && b.configured()) list.push(b);
  if ((pref === "auto" || pref === "tavily") && t.configured()) list.push(t);
  list.push(wikipedia);
  return list;
}
