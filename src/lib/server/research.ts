import "server-only";
import type { Candidate, Contradiction, Entity, EntityType, GeoLocation, SearchQuery, SearchResult, Source, SourceCategory, TimelineEvent } from "@/lib/types";
import type { CandidateRequest, EntityRequest, ResearchDelta, SearchRequest, TextInput, VerifyRequest } from "@/lib/engine/protocol";
import { compact, hostOf, norm, nowIso, pLimit, textSupport, uid, uniqBy, yearOf } from "@/lib/util";
import { fetchJson } from "./http";
import type { ProviderContext } from "./settings";
import { classify, getEntities, getLabels, nameHistory, type EntityClass, type WDEntity } from "@/lib/providers/wikidata";
import { commonsImages, gdelt, searchHistoricalNewspapers, wikipediaSummary, webProviders, youtube, brave } from "@/lib/providers/search";
import { mapProvider } from "@/lib/providers/maps";
import type { ProviderResult, WebHit } from "@/lib/providers/types";

// ---------------------------------------------------------------------------
// Sources & queries
// ---------------------------------------------------------------------------

const OFFICIAL_HINTS = /\.(gov|mil|edu)(\.|$)|\bnba\.com$|\bnfl\.com$|\bmlb\.com$|\bnhl\.com$|\bfifa\.com$|\buefa\.com$|\bolympics\.com$/;

export function categorize(url: string, fallback: SourceCategory = "other"): SourceCategory {
  const h = hostOf(url);
  if (!h) return fallback;
  if (/wikipedia\.org|wikidata\.org|britannica\.com/.test(h)) return "reference";
  if (/openstreetmap\.org|google\.[a-z.]+\/maps|maps\.google|mapquest/.test(h + new URL(url).pathname)) return "maps";
  if (/commons\.wikimedia\.org|flickr\.com|gettyimages|unsplash/.test(h)) return "images";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(h)) return "videos";
  if (/espn\.com|basketball-reference|sports-reference|nba\.com|nfl\.com|mlb\.com|nhl\.com|fifa\.com|transfermarkt/.test(h)) return "sports";
  if (/\.gov$|\.gov\.|loc\.gov|\.mil$|archives\.gov/.test(h)) return "government";
  if (/(news|times|post|herald|tribune|guardian|bbc|cnn|reuters|apnews|ajc\.com|journal|gazette|chronicle)/.test(h)) return "news";
  return fallback;
}

export function makeSource(p: Partial<Source> & Pick<Source, "title" | "url" | "provider">): Source {
  const category = p.category || categorize(p.url);
  return {
    id: uid("src"),
    publisher: p.publisher || hostOf(p.url) || p.provider,
    accessedAt: nowIso(),
    excerpt: "",
    supports: [],
    type: "webpage",
    reliability: { tier: "secondary", note: "" },
    usedInReasoning: false,
    verified: true,
    ...p,
    category,
  };
}

function q(branch: string, text: string, kind: SearchQuery["kind"], provider: string): SearchQuery {
  return { id: uid("q"), branch, text, kind, provider, status: "pending", resultCount: 0, createdAt: nowIso() };
}

function finishQuery<T>(query: SearchQuery, r: ProviderResult<T>) {
  query.status = r.status === "ok" ? "ok" : r.status === "empty" ? "empty" : r.status;
  query.resultCount = r.items.length;
  query.cached = r.cached;
  query.durationMs = r.ms;
  if (r.error) query.error = r.error;
  query.provider = r.provider;
}

function emptyDelta(): ResearchDelta {
  return { queries: [], results: [], sources: [], entities: [], candidates: [], locations: [], timeline: [], contradictions: [], notes: [], providerWarnings: [] };
}

function webHitsToDelta(delta: ResearchDelta, query: SearchQuery, hits: WebHit[], defaultCat: SourceCategory, officialOnly = false) {
  for (const h of hits) {
    if (officialOnly && !OFFICIAL_HINTS.test(hostOf(h.url)) && categorize(h.url) !== "government") continue;
    const src = makeSource({
      title: h.title,
      url: h.url,
      provider: query.provider,
      publisher: h.publisher,
      publishedAt: h.publishedAt,
      excerpt: h.snippet,
      category: h.category || categorize(h.url, defaultCat),
      type: defaultCat === "videos" ? "video" : defaultCat === "news" ? "article" : "webpage",
      reliability: { tier: OFFICIAL_HINTS.test(hostOf(h.url)) ? "primary" : "tertiary", note: `Search result from ${query.provider}; content not independently verified beyond the snippet.` },
      why: `Returned for the query “${query.text}”.`,
    });
    delta.sources.push(src);
    delta.results.push({ id: uid("r"), queryId: query.id, title: h.title, url: h.url, snippet: h.snippet, thumbnail: h.thumbnail, sourceId: src.id, publishedAt: h.publishedAt });
  }
}

// ---------------------------------------------------------------------------
// Generic search (web/news/videos/images/history)
// ---------------------------------------------------------------------------

export async function runSearch(req: SearchRequest, ctx: ProviderContext): Promise<ResearchDelta> {
  const d = emptyDelta();
  const officialOnly = req.officialOnly || ctx.prefs.officialSourcesOnly;
  if (req.kind === "web" || req.kind === "knowledge") {
    const providers = webProviders(ctx);
    for (const p of providers.slice(0, 2)) {
      const query = { ...q(req.branch, req.query, "web", p.id), userAdded: req.userAdded };
      const r = await p.searchWeb!(req.query, 8);
      finishQuery(query, r);
      d.queries.push(query);
      webHitsToDelta(d, query, r.items, "reference", officialOnly);
      if (r.status === "ok") break;
    }
  } else if (req.kind === "news") {
    const b = brave(ctx);
    const provs = [b.configured() ? b : null, gdelt].filter(Boolean) as (typeof gdelt)[];
    for (const p of provs) {
      const query = { ...q(req.branch, req.query, "news", p.id), userAdded: req.userAdded };
      const r = await p.searchNews!(req.query, 8);
      finishQuery(query, r);
      d.queries.push(query);
      webHitsToDelta(d, query, r.items, "news", officialOnly);
      if (r.status === "ok") break;
    }
  } else if (req.kind === "videos") {
    const yt = youtube(ctx);
    const b = brave(ctx);
    const p = yt.configured() ? yt : b.configured() ? b : null;
    const query = { ...q(req.branch, req.query, "videos", p?.id || "youtube"), userAdded: req.userAdded };
    if (!p) {
      query.status = "not_configured";
      query.error = "Video search needs YOUTUBE_API_KEY or BRAVE_SEARCH_API_KEY. TRACE does not analyse video frames; it records public video metadata only.";
      d.queries.push(query);
    } else {
      const r = await p.searchVideos!(req.query, 8);
      finishQuery(query, r);
      d.queries.push(query);
      webHitsToDelta(d, query, r.items, "videos", officialOnly);
    }
  } else if (req.kind === "history") {
    const query = { ...q(req.branch, req.query, "history", "loc"), userAdded: req.userAdded };
    const r = await searchHistoricalNewspapers(req.query, 8);
    finishQuery(query, r);
    d.queries.push(query);
    webHitsToDelta(d, query, r.items, "government");
  } else if (req.kind === "images") {
    const query = { ...q(req.branch, req.query, "images", "wikimedia-commons"), userAdded: req.userAdded };
    const r = await commonsImages(req.query, 10);
    finishQuery(query, r);
    d.queries.push(query);
    for (const im of r.items) {
      const src = makeSource({
        title: im.title,
        url: im.url,
        provider: "wikimedia-commons",
        publisher: "Wikimedia Commons",
        category: "images",
        type: "image",
        excerpt: `${im.license || "license on page"}${im.author ? ` · ${im.author}` : ""}`,
        reliability: { tier: "secondary", note: "Community-uploaded photo; captions are user-supplied." },
      });
      d.sources.push(src);
      d.results.push({ id: uid("r"), queryId: query.id, title: im.title, url: im.url, snippet: src.excerpt, thumbnail: im.thumb, sourceId: src.id });
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

const STOP = new Set(
  "the and for with from this that are was were you your our not all any can will but its into new old open closed exit entrance welcome sale only no yes www com http https tel phone call now free".split(" "),
);
// Common words that are too ambiguous to look up on their own (multi-word phrases still use them).
const COMMON = new Set(
  "state farm arena center centre stadium field court park street road avenue hotel restaurant cafe bar city club team home away game sport sports national international american united royal grand central north south east west first second third great golden royal new old main market house hall tower bank insurance energy bank coffee pizza grill kitchen bakery store shop service services company group news daily times post herald world life family church school college university station airport line bus taxi parking public official only lane drive way place square plaza".split(" "),
);

const SCENE_CONTEXT: Record<string, string> = {
  basketball: "basketball",
  soccer: "football club",
  football: "football",
  baseball: "baseball",
  hockey: "ice hockey",
  tennis: "tennis",
  arena: "arena",
  stadium: "stadium",
  hotel: "hotel",
  restaurant: "restaurant",
  street: "street",
  university: "university",
  newspaper: "newspaper",
  document: "",
  storefront: "",
};

const SPORT_QIDS: Record<string, string> = { basketball: "Q5372", soccer: "Q2736", baseball: "Q5369", football: "Q41323", hockey: "Q41466", tennis: "Q847" };

function phrasesFrom(texts: TextInput[], max: number) {
  const out = new Map<string, { phrase: string; weight: number; clueIds: string[]; origins: Set<string> }>();
  const add = (phrase: string, weight: number, t: TextInput) => {
    const p = phrase.replace(/\s+/g, " ").trim();
    const c = compact(p);
    if (c.length < 3 || c.length > 48 || /^\d+$/.test(c)) return;
    const words = norm(p).split(" ");
    if (words.every((w) => STOP.has(w) || w.length < 3)) return;
    const cur = out.get(c);
    if (cur) {
      cur.weight += weight * 0.5;
      if (t.clueId) cur.clueIds.push(t.clueId);
      cur.origins.add(t.origin);
    } else out.set(c, { phrase: p, weight, clueIds: t.clueId ? [t.clueId] : [], origins: new Set([t.origin]) });
  };
  for (const t of texts) {
    const conf = Math.max(0.15, t.confidence / 100);
    const clean = t.text.replace(/[^\p{L}\p{N}&'.\- ]+/gu, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const words = clean.split(" ").filter(Boolean);
    const originBoost = t.origin === "logo" ? 1.6 : t.origin === "ai" || t.origin === "cloud-vision" ? 1.3 : 1;
    const single = words.length === 1 ? words[0].toLowerCase() : "";
    if (words.length <= 5 && !(single && (single.length < 4 || STOP.has(single) || COMMON.has(single)))) add(clean, conf * originBoost * (1 + Math.min(words.length, 4) * 0.15), t);
    // split CamelCase brand reads ("StateFarm" → "State Farm")
    const decamel = clean.replace(/([a-z])([A-Z])/g, "$1 $2");
    if (decamel !== clean) add(decamel, conf * originBoost * 1.1, t);
    for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n).join(" ");
        if (n === 1 && (gram.length < 4 || STOP.has(gram.toLowerCase()) || COMMON.has(gram.toLowerCase()))) continue;
        add(gram, conf * originBoost * (0.6 + n * 0.15), t);
      }
    }
  }
  return [...out.values()].sort((a, b) => b.weight - a.weight).slice(0, max);
}

async function wikipediaToQids(titles: string[]): Promise<Record<string, string>> {
  if (!titles.length) return {};
  const { data } = await fetchJson<{ query?: { pages?: Record<string, { title: string; pageprops?: { wikibase_item?: string } }>; redirects?: { from: string; to: string }[] } }>(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(titles.join("|"))}`,
    { provider: "wikipedia", op: "pageprops", cacheTtl: 30 * 86400 },
  );
  const out: Record<string, string> = {};
  for (const p of Object.values(data.query?.pages || {})) if (p.pageprops?.wikibase_item) out[p.title] = p.pageprops.wikibase_item;
  return out;
}

const CLASS_TO_TYPE: Record<EntityClass, EntityType> = {
  sports_team: "sports_team",
  venue: "venue",
  building: "building",
  city: "city",
  country: "country",
  region: "region",
  street: "place",
  organization: "organization",
  brand: "brand",
  publication: "publication",
  event: "event",
  university: "building",
  hotel: "building",
  restaurant: "building",
  public_figure: "public_figure",
  other: "other",
};

export async function resolveEntities(req: EntityRequest, ctx: ProviderContext): Promise<ResearchDelta> {
  const d = emptyDelta();
  const hints = req.sceneHints.map((h) => h.toLowerCase());
  const sportHint = Object.keys(SPORT_QIDS).find((s) => hints.includes(s));
  const ctxWord = hints.map((h) => SCENE_CONTEXT[h]).find((w) => w) || "";
  const texts: TextInput[] = [
    ...req.texts,
    ...(req.logos || []).map((l) => ({ text: l.name, confidence: l.confidence * 100, origin: "logo" as const, clueId: l.clueId })),
    ...(req.aiEntities || []).map((e) => ({ text: e.name, confidence: 70, origin: "ai" as const })),
    ...(req.landmarks || []).map((l) => ({ text: l.name, confidence: l.score * 100, origin: "cloud-vision" as const })),
  ];
  const phrases = phrasesFrom(texts, Math.min(req.maxLookups ?? 10, 14));

  // regex entities: addresses, phones, websites, dates
  const joined = req.texts.map((t) => t.text).join("\n");
  const regexEntities: Entity[] = [];
  const pushRegex = (name: string, type: EntityType, because: string) =>
    regexEntities.push({ id: uid("ent"), name, type, detectedBecause: [because], clueIds: [], sourceIds: [], locationIds: [], matchQuality: "moderate" });
  for (const m of joined.matchAll(/\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct)\b\.?/g)) pushRegex(m[0], "address", "Address pattern in OCR text");
  for (const m of joined.matchAll(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]{3,}\.(?:com|org|net|edu|gov|co\.uk|ca|io)\b/gi)) pushRegex(m[0].toLowerCase(), "website", "Website pattern in OCR text");
  for (const m of joined.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(1[6-9]\d\d|20\d\d)\b/gi)) pushRegex(m[0], "date", "Date pattern in OCR text");
  d.entities!.push(...uniqBy(regexEntities, (e) => compact(e.name)));

  const found = new Map<string, { hit: WDEntity; phrases: string[]; clueIds: string[]; support: number; base: number; origins: Set<string> }>();

  await pLimit(phrases, 4, async (ph) => {
    const searchText = `${ph.phrase} ${ctxWord}`.trim();
    const query = q("entities", searchText, "knowledge", "wikipedia");
    try {
      const { data, cached, ms } = await fetchJson<{ query?: { search: { title: string }[] } }>(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srprop=&srsearch=${encodeURIComponent(searchText)}`,
        { provider: "wikipedia", op: "entity-search", cacheTtl: 7 * 86400 },
      );
      const titles = (data.query?.search || []).map((s) => s.title);
      query.status = titles.length ? "ok" : "empty";
      query.resultCount = titles.length;
      query.cached = cached;
      query.durationMs = ms;
      d.queries.push(query);
      if (!titles.length) return;
      const qids = await wikipediaToQids(titles);
      const ents = await getEntities(Object.values(qids));
      const rank = (id: string) => {
        const t = Object.entries(qids).find(([, q]) => q === id)?.[0];
        const i = titles.findIndex((x) => x === t);
        return i < 0 ? 9 : i;
      };
      let best: { e: WDEntity; support: number; base: number } | null = null;
      for (const e of Object.values(ents)) {
        const cls = classify(e.description, e.label);
        const names = [e.label, ...e.aliases];
        let base = 0;
        for (const n of names) {
          const ts = textSupport(ph.phrase, n);
          // a fragment covering only a small part of a long name is not a match
          const coverage = compact(ph.phrase).length / Math.max(1, compact(n).length);
          const v = ts.how.startsWith("partial") && coverage < 0.34 ? 0 : ts.score;
          base = Math.max(base, v);
        }
        if (cls === "public_figure" && !(base >= 0.95 && ph.phrase.trim().split(/\s+/).length >= 2)) continue; // privacy: no person look-ups from fragments
        const sceneFit =
          (sportHint && cls === "sports_team" && new RegExp(sportHint === "soccer" ? "football|soccer" : sportHint, "i").test(e.description)) ||
          (hints.includes("hotel") && cls === "hotel") ||
          (hints.includes("restaurant") && cls === "restaurant") ||
          (hints.includes("street") && cls === "street") ||
          (hints.includes("newspaper") && cls === "publication") ||
          ((hints.includes("arena") || hints.includes("stadium")) && cls === "venue");
        const support = base + (sceneFit ? 0.2 : 0) - rank(e.id) * 0.01;
        if (base < 0.55 || support < 0.7) continue;
        if (!best || support > best.support) best = { e, support, base };
      }
      if (best) {
        const { e, support, base } = best;
        const cur = found.get(e.id);
        if (cur) {
          cur.phrases.push(ph.phrase);
          cur.clueIds.push(...ph.clueIds);
          cur.support = Math.max(cur.support, support) + 0.1;
          cur.base = Math.max(cur.base, base);
          ph.origins.forEach((o) => cur.origins.add(o));
        } else found.set(e.id, { hit: e, phrases: [ph.phrase], clueIds: [...ph.clueIds], support, base, origins: new Set(ph.origins) });
      }
    } catch (e) {
      query.status = "error";
      query.error = e instanceof Error ? e.message : String(e);
      d.queries.push(query);
    }
  });

  // Naming-rights venues: an organization read on the image plus a venue-type scene ("State Farm" + arena)
  const venueWord = hints.includes("arena") ? "Arena" : hints.includes("stadium") ? "Stadium" : null;
  if (venueWord) {
    const orgs = [...found.values()].filter((f) => ["organization", "brand", "other"].includes(classify(f.hit.description, f.hit.label)));
    await pLimit(orgs.slice(0, 3), 2, async (o) => {
      const phrase = `${o.phrases[0].replace(/([a-z])([A-Z])/g, "$1 $2")} ${venueWord}`;
      const query = q("entities", phrase, "knowledge", "wikipedia");
      try {
        const { data } = await fetchJson<{ query?: { search: { title: string }[] } }>(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srprop=&srsearch=${encodeURIComponent(phrase)}`,
          { provider: "wikipedia", op: "entity-search", cacheTtl: 7 * 86400 },
        );
        const titles = (data.query?.search || []).map((s) => s.title);
        query.status = titles.length ? "ok" : "empty";
        query.resultCount = titles.length;
        d.queries.push(query);
        const ents = await getEntities(Object.values(await wikipediaToQids(titles)));
        for (const e of Object.values(ents)) {
          if (classify(e.description, e.label) !== "venue") continue;
          const base = Math.max(...[e.label, ...e.aliases].map((n) => textSupport(phrase, n).score));
          if (base < 0.9 || found.has(e.id)) continue;
          found.set(e.id, { hit: e, phrases: [`${o.phrases[0]} (sponsor) + ${venueWord.toLowerCase()} scene`], clueIds: o.clueIds, support: 0.8, base: 0.7, origins: o.origins });
          break;
        }
      } catch (err) {
        query.status = "error";
        query.error = err instanceof Error ? err.message : String(err);
        d.queries.push(query);
      }
    });
  }

  for (const { hit, phrases: phs, clueIds, support, base, origins } of [...found.values()].sort((a, b) => b.support - a.support).slice(0, 12)) {
    const cls = classify(hit.description, hit.label);
    const src = makeSource({
      title: `${hit.label} — Wikidata ${hit.id}`,
      url: hit.url,
      provider: "wikidata",
      publisher: "Wikidata",
      category: "reference",
      type: "api-record",
      excerpt: hit.description,
      supports: [`“${hit.label}” is ${hit.description || "a Wikidata item"}`],
      reliability: { tier: "secondary", note: "Structured, community-maintained knowledge base; statements may carry references." },
      why: `Matched visible text ${phs.map((p) => `“${p}”`).join(", ")}.`,
      usedInReasoning: true,
    });
    d.sources.push(src);
    d.entities!.push({
      id: uid("ent"),
      name: hit.label,
      type: CLASS_TO_TYPE[cls],
      wikidataId: hit.id,
      description: hit.description,
      detectedBecause: [
        `Text ${phs.map((p) => `“${p}”`).join(", ")} ${origins.has("logo") ? "(logo)" : origins.has("ai") ? "(AI vision reading)" : "(OCR)"} matches this name`,
        ...(base >= 0.95 ? [] : ["Partial or context-assisted match — treat as a lead"]),
      ],
      clueIds: Array.from(new Set(clueIds)),
      sourceIds: [src.id],
      locationIds: [],
      matchQuality: base >= 0.95 || (phs.length > 1 && support >= 0.9) ? "strong" : base >= 0.62 || support >= 0.85 ? "moderate" : "weak",
    });
  }
  if (!d.entities!.length) d.notes!.push("No entities could be confidently matched to the visible text.");
  return d;
}

// ---------------------------------------------------------------------------
// Candidate generation (knowledge graph)
// ---------------------------------------------------------------------------

const PLACE_CLASSES: EntityClass[] = ["venue", "building", "hotel", "restaurant", "university", "street"];

function addTimeline(d: ResearchDelta, date: string | undefined, label: string, kind: TimelineEvent["kind"], candidateId: string | undefined, sourceIds: string[]) {
  const year = yearOf(date);
  if (!year || !date) return;
  d.timeline!.push({ id: uid("t"), date, year, label, kind, candidateId, sourceIds });
}

function contradictionsFor(e: WDEntity, srcId: string, wiki?: { extract: string; srcId: string }): Contradiction[] {
  const out: Contradiction[] = [];
  const check = (prop: string, label: string, vals: { value: string }[]) => {
    const years = Array.from(new Set(vals.map((v) => yearOf(v.value)).filter(Boolean)));
    if (years.length > 1) out.push({ id: uid("cx"), subject: e.label, property: label, claims: years.map((y) => ({ value: String(y), sourceId: srcId })), note: `Wikidata lists multiple ${label} years for ${e.label}.` });
  };
  check("P571", "inception", e.inception);
  check("P1619", "opening", e.opened);
  if (wiki) {
    const m = wiki.extract.match(/\bopened (?:on |in )?(?:[A-Z][a-z]+ \d{1,2}, )?((?:1[6-9]|20)\d\d)\b/);
    const wdYear = yearOf(e.opened[0]?.value || e.inception[0]?.value);
    if (m && wdYear && Number(m[1]) !== wdYear) {
      out.push({
        id: uid("cx"),
        subject: e.label,
        property: "opening year",
        claims: [
          { value: String(wdYear), sourceId: srcId },
          { value: m[1], sourceId: wiki.srcId },
        ],
        note: `Wikidata and the Wikipedia summary disagree on when ${e.label} opened. TRACE does not pick one silently.`,
      });
    }
  }
  return out;
}

async function buildCandidate(
  d: ResearchDelta,
  e: WDEntity,
  labels: Record<string, string>,
  opts: { kind: string; derivedFrom: string[]; tenancy?: { team: string; from?: string; to?: string; teamSrc: string }; why: string[] },
): Promise<Candidate> {
  const id = uid("cand");
  const wdSrc = makeSource({
    title: `${e.label} — Wikidata ${e.id}`,
    url: e.url,
    provider: "wikidata",
    publisher: "Wikidata",
    category: "reference",
    type: "api-record",
    excerpt: [e.description, e.address, e.coord ? `${e.coord.lat.toFixed(5)}, ${e.coord.lng.toFixed(5)}` : ""].filter(Boolean).join(" · "),
    supports: [
      `${e.label}: ${e.description}`,
      ...(e.coord ? [`Coordinates ${e.coord.lat.toFixed(4)}, ${e.coord.lng.toFixed(4)}`] : []),
      ...(e.address ? [`Address: ${e.address}`] : []),
      ...(e.opened[0] ? [`Opened ${e.opened[0].value}`] : []),
    ],
    reliability: { tier: "secondary", note: "Wikidata statements; check referenced sources for critical facts." },
    usedInReasoning: true,
    why: `Structured record for candidate ${e.label}.`,
  });
  d.sources.push(wdSrc);
  const sourceIds = [wdSrc.id];
  if (opts.tenancy) sourceIds.push(opts.tenancy.teamSrc);

  let wiki: { extract: string; srcId: string } | undefined;
  if (e.enwiki) {
    const s = await wikipediaSummary(e.enwiki);
    if (s?.extract) {
      const src = makeSource({
        title: `${s.title} — Wikipedia`,
        url: s.url,
        provider: "wikipedia",
        publisher: "Wikipedia",
        category: "reference",
        excerpt: s.extract.slice(0, 600),
        supports: [`Summary of ${s.title}`],
        reliability: { tier: "tertiary", note: "Encyclopedia summary; verify key facts against its citations." },
        usedInReasoning: true,
      });
      d.sources.push(src);
      sourceIds.push(src.id);
      wiki = { extract: s.extract, srcId: src.id };
    }
  }
  for (const w of e.websites.slice(0, 2)) {
    const src = makeSource({
      title: `Official website — ${hostOf(w.value)}`,
      url: w.value,
      provider: "wikidata",
      publisher: hostOf(w.value),
      category: "official",
      excerpt: `Listed as official website by Wikidata${w.from ? ` from ${w.from}` : ""}${w.to ? ` until ${w.to}` : ""}.`,
      reliability: { tier: "primary", note: "Official site as listed by Wikidata. TRACE did not fetch or verify the page content." },
      verified: false,
      why: "Official website reference for the candidate (not fetched).",
    });
    d.sources.push(src);
    sourceIds.push(src.id);
  }

  const names = nameHistory(e);
  let locationId: string | undefined;
  if (e.coord) {
    const loc: GeoLocation = {
      id: uid("loc"),
      name: e.label,
      address: e.address,
      lat: e.coord.lat,
      lng: e.coord.lng,
      kind: opts.kind,
      wikidataId: e.id,
      sourceIds: [wdSrc.id],
    };
    d.locations!.push(loc);
    locationId = loc.id;
  }

  addTimeline(d, e.inception[0]?.value, `${e.label} established / built`, "construction", id, [wdSrc.id]);
  addTimeline(d, e.opened[0]?.value, `${e.label} opened`, "opening", id, [wdSrc.id]);
  addTimeline(d, e.closed[0]?.value, `${e.label} closed`, "closure", id, [wdSrc.id]);
  addTimeline(d, e.dissolved[0]?.value, `${e.label} demolished / dissolved`, "closure", id, [wdSrc.id]);
  for (const n of names) {
    if (n.to) addTimeline(d, n.to, `End of name “${n.name}” (${n.basis})`, "renaming", id, [wdSrc.id]);
    if (n.from) addTimeline(d, n.from, `Name “${n.name}” in use (${n.basis})`, "renaming", id, [wdSrc.id]);
  }
  if (opts.tenancy?.from) addTimeline(d, opts.tenancy.from, `${opts.tenancy.team} begin playing home games at ${e.label}`, "tenancy", id, [opts.tenancy.teamSrc, wdSrc.id]);
  if (opts.tenancy?.to) addTimeline(d, opts.tenancy.to, `${opts.tenancy.team} leave ${e.label}`, "tenancy", id, [opts.tenancy.teamSrc, wdSrc.id]);

  d.contradictions!.push(...contradictionsFor(e, wdSrc.id, wiki));

  const descCity = e.description.match(/\b(?:in|located in)\s+([A-Z][\p{L}.' -]+?)(?:,|$)/u)?.[1];
  const city = descCity || e.locatedIn.map((x) => labels[x]).filter(Boolean)[0];
  const country = e.country.map((x) => labels[x]).filter(Boolean)[0];
  const images = e.image
    ? [
        {
          id: uid("cimg"),
          url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(e.image.replace(/ /g, "_"))}`,
          thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(e.image)}?width=640`,
          title: e.image,
          sourceId: wdSrc.id,
        },
      ]
    : [];

  return {
    id,
    name: e.label,
    kind: opts.kind,
    wikidataId: e.id,
    locationId,
    city,
    country,
    address: e.address,
    description: e.description,
    names: names.map(({ name, from, to }) => ({ name, from, to })),
    activeFrom: opts.tenancy?.from,
    activeTo: opts.tenancy?.to,
    inception: e.opened[0]?.value || e.inception[0]?.value,
    why: opts.why,
    against: [],
    evidenceIds: [],
    sourceIds,
    signals: { text: null, logo: null, visual: null, geo: null, temporal: null, source: null, exif: null, link: null },
    confidence: "insufficient",
    confidenceReasons: [],
    status: "active",
    images,
    derivedFrom: opts.derivedFrom,
    commonsCategory: e.commonsCategory,
  };
}

export async function knowledgeCandidates(req: CandidateRequest, ctx: ProviderContext): Promise<ResearchDelta> {
  void ctx;
  const d = emptyDelta();
  const max = req.maxCandidates ?? 10;
  const withQid = req.entities.filter((e) => e.wikidataId);
  if (!withQid.length) {
    d.notes!.push("No knowledge-graph entities to expand.");
    return d;
  }
  const query = q("knowledge", `Expand ${withQid.map((e) => e.name).join(", ")} via Wikidata relations`, "knowledge", "wikidata");
  d.queries.push(query);
  const ents = await getEntities(withQid.map((e) => e.wikidataId!));
  const teamVenues: { venue: string; team: WDEntity; from?: string; to?: string; teamSrc: string }[] = [];
  const direct: WDEntity[] = [];
  for (const e of Object.values(ents)) {
    const cls = classify(e.description, e.label);
    if (cls === "sports_team" && e.homeVenues.length) {
      const teamSrc = makeSource({
        title: `${e.label} home venues — Wikidata ${e.id} (P115)`,
        url: `${e.url}#P115`,
        provider: "wikidata",
        publisher: "Wikidata",
        category: "sports",
        type: "api-record",
        excerpt: `${e.homeVenues.length} home-venue statements with ${e.homeVenues.filter((v) => v.from || v.to).length} dated periods.`,
        supports: [`Home venues of ${e.label}`],
        reliability: { tier: "secondary", note: "Wikidata home-venue (P115) statements and their date qualifiers." },
        usedInReasoning: true,
      });
      d.sources.push(teamSrc);
      for (const v of e.homeVenues) teamVenues.push({ venue: v.value, team: e, from: v.from, to: v.to, teamSrc: teamSrc.id });
    } else if (PLACE_CLASSES.includes(cls) && e.coord) direct.push(e);
  }
  const venueEnts = await getEntities(teamVenues.map((t) => t.venue));
  const labels = await getLabels([...Object.values(venueEnts), ...direct].flatMap((e) => [...e.locatedIn.slice(0, 1), ...e.country.slice(0, 1)]));

  const cands: Candidate[] = [];
  // Most-recent tenancy first so the list mirrors real-world likelihood without asserting it
  const sortedTV = teamVenues.sort((a, b) => (yearOf(b.from) || 0) - (yearOf(a.from) || 0));
  const seen = new Set<string>();
  await pLimit(sortedTV, 3, async (tv) => {
    const v = venueEnts[tv.venue];
    if (!v || cands.length >= max) return;
    const prev = cands.find((c) => c.wikidataId === v.id);
    if (seen.has(v.id) && !prev) {
      // another branch is building this venue right now — record the extra tenancy once it lands
      await new Promise((r) => setTimeout(r, 50));
    }
    const again = cands.find((c) => c.wikidataId === v.id);
    if (again || seen.has(v.id)) {
      if (again) again.why.push(`${tv.team.label} also played home games here ${tv.from || "?"}–${tv.to || "present"} (Wikidata).`);
      return;
    }
    seen.add(v.id);
    if (prev) {
      prev.why.push(`${tv.team.label} also played home games here ${tv.from || "?"}–${tv.to || "present"} (Wikidata).`);
      return;
    }
    cands.push(
      await buildCandidate(d, v, labels, {
        kind: "venue",
        derivedFrom: [tv.team.label],
        tenancy: { team: tv.team.label, from: tv.from, to: tv.to, teamSrc: tv.teamSrc },
        why: [`Listed as a home venue of ${tv.team.label}${tv.from || tv.to ? ` (${tv.from || "?"}–${tv.to || "present"})` : ""} in Wikidata.`],
      }),
    );
  });
  for (const e of direct) {
    if (cands.length >= max || cands.some((c) => c.wikidataId === e.id)) continue;
    const from = withQid.find((x) => x.wikidataId === e.id);
    cands.push(
      await buildCandidate(d, e, labels, {
        kind: classify(e.description, e.label),
        derivedFrom: [from?.name || e.label],
        why: [`Visible text matched the name “${e.label}”, a ${e.description || "place"} with known coordinates.`],
      }),
    );
  }
  d.candidates = cands;
  query.status = cands.length ? "ok" : "empty";
  query.resultCount = cands.length;
  if (teamVenues.length) d.notes!.push("A team's home venues are candidates, not conclusions: away, neutral-site, exhibition and temporary venues remain possible.");
  return d;
}

// ---------------------------------------------------------------------------
// Candidate generation (maps / places)
// ---------------------------------------------------------------------------

export async function placeCandidates(req: CandidateRequest, ctx: ProviderContext): Promise<ResearchDelta> {
  const d = emptyDelta();
  const maps = mapProvider(ctx);
  const cityEnt = req.entities.find((e) => e.type === "city");
  const cands: Candidate[] = [];

  const pushPlace = (hit: { name: string; displayName: string; lat: number; lng: number; kind: string; url: string; address?: string; osmRef?: string; wikidataId?: string }, why: string, derivedFrom: string, provider: string, extraSupports: string[] = []) => {
    const src = makeSource({
      title: `${hit.name} — ${provider === "osm-nominatim" ? "OpenStreetMap" : provider}`,
      url: hit.url,
      provider,
      category: "maps",
      type: "map",
      publisher: provider.startsWith("osm") ? "OpenStreetMap contributors" : "Google Maps Platform",
      excerpt: hit.displayName,
      supports: [`${hit.name} is located at ${hit.lat.toFixed(4)}, ${hit.lng.toFixed(4)}`, ...extraSupports],
      reliability: { tier: "secondary", note: "Map database record." },
      usedInReasoning: true,
    });
    d.sources.push(src);
    const loc: GeoLocation = { id: uid("loc"), name: hit.name, address: hit.address || hit.displayName, lat: hit.lat, lng: hit.lng, kind: hit.kind, osmRef: hit.osmRef, wikidataId: hit.wikidataId, sourceIds: [src.id] };
    d.locations!.push(loc);
    const parts = hit.displayName.split(",").map((s) => s.trim());
    cands.push({
      id: uid("cand"),
      name: hit.name,
      kind: hit.kind,
      wikidataId: hit.wikidataId,
      locationId: loc.id,
      city: parts.length > 3 ? parts[parts.length - 4] : parts[1],
      country: parts[parts.length - 1],
      address: hit.displayName,
      names: [{ name: hit.name }],
      why: [why],
      against: [],
      evidenceIds: [],
      sourceIds: [src.id],
      signals: { text: null, logo: null, visual: null, geo: null, temporal: null, source: null, exif: null, link: null },
      confidence: "insufficient",
      confidenceReasons: [],
      status: "active",
      images: [],
      derivedFrom: [derivedFrom],
    });
  };

  // 1. Photo GPS metadata
  if (req.exif?.lat !== undefined && req.exif?.lng !== undefined) {
    const query = q("maps", `Reverse geocode photo GPS ${req.exif.lat.toFixed(5)}, ${req.exif.lng.toFixed(5)}`, "maps", maps.id);
    const r = await maps.reverse(req.exif.lat, req.exif.lng);
    finishQuery(query, r);
    d.queries.push(query);
    if (r.items[0]) pushPlace({ ...r.items[0], lat: req.exif.lat, lng: req.exif.lng }, "The photo's embedded GPS metadata points here (metadata can be edited or stripped; treat as strong but not infallible).", "EXIF GPS", r.provider, ["Photo GPS metadata location"]);
  }

  // 2. Landmarks detected by Google Cloud Vision
  for (const lm of (req.landmarks || []).filter((l) => l.lat !== undefined).slice(0, 2)) {
    const query = q("maps", `Reverse geocode landmark “${lm.name}”`, "maps", maps.id);
    const r = await maps.reverse(lm.lat!, lm.lng!);
    finishQuery(query, r);
    d.queries.push(query);
    if (r.items[0]) pushPlace({ ...r.items[0], name: lm.name, lat: lm.lat!, lng: lm.lng! }, `Google Cloud Vision landmark detection recognised “${lm.name}”.`, "Cloud Vision landmark", r.provider);
  }

  // 3. Places / streets / addresses named in the image
  const placeLike = req.entities.filter((e) => ["address", "place", "building"].includes(e.type) && !e.wikidataId);
  const textPlaces = req.texts
    .filter((t) => t.confidence >= 55 && /\b(hotel|restaurant|cafe|café|bar|diner|inn|motel|street|avenue|ave|road|boulevard|blvd|plaza|square|station|library|museum|church|school|university|college|hall|theatre|theater)\b/i.test(t.text))
    .map((t) => t.text.replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 5 && t.length <= 60);
  const hintWord = req.sceneHints.find((h) => ["hotel", "restaurant", "street", "university"].includes(h));
  const lookups = uniqBy(
    [
      ...placeLike.map((e) => e.name),
      ...textPlaces,
      ...(hintWord && hintWord !== "street" ? req.texts.filter((t) => t.confidence >= 60 && t.text.trim().length >= 4).slice(0, 2).map((t) => `${t.text.trim()} ${hintWord}`) : []),
      ...(hintWord === "street" ? req.texts.filter((t) => t.confidence >= 60 && /^[A-Za-z .'-]{4,30}$/.test(t.text.trim())).slice(0, 2).map((t) => t.text.trim()) : []),
    ],
    (s) => compact(s),
  ).slice(0, 3);

  for (const look of lookups) {
    const text = cityEnt ? `${look}, ${cityEnt.name}` : look;
    const query = q("maps", text, "maps", maps.id);
    const r = await maps.geocode(text, 5);
    finishQuery(query, r);
    d.queries.push(query);
    const many = r.items.length > 1;
    for (const hit of r.items.slice(0, 4)) {
      if (cands.some((c) => Math.abs((d.locations!.find((l) => l.id === c.locationId)?.lat || 0) - hit.lat) < 0.0005 && c.name === hit.name)) continue;
      pushPlace(hit, `Map search for “${look}” (from visible text) returned this ${hit.kind.split(":")[1] || "place"}${many ? "; the same name exists in several places" : ""}.`, look, r.provider);
    }
  }
  d.candidates = cands.slice(0, req.maxCandidates ?? 10);
  return d;
}

// ---------------------------------------------------------------------------
// Candidate reference images
// ---------------------------------------------------------------------------

export async function candidateImages(name: string, city: string | undefined, category: string | undefined, sceneHint: string | undefined, aliases: string[] = []): Promise<ResearchDelta & { images: { candidateName: string; title: string; url: string; thumb: string; license?: string; sourceId: string }[] }> {
  const d = emptyDelta();
  const images: { candidateName: string; title: string; url: string; thumb: string; license?: string; sourceId: string }[] = [];
  const attempts: { text: string; category?: string }[] = [];
  // scene-appropriate photos first (e.g. arena interiors for a court photo), then the place's own category
  if (sceneHint && sceneHint !== "street") attempts.push({ text: `${name} ${sceneHint}` });
  if (category) attempts.push({ text: `Category:${category}`, category });
  attempts.push({ text: `${name}${city ? ` ${city}` : ""}` });
  for (const a of attempts) {
    const query = q("visual-search", a.text, "images", "wikimedia-commons");
    const r = await commonsImages(a.text, a.category ? 12 : 10, a.category ? { category: a.category } : {});
    finishQuery(query, r);
    d.queries.push(query);
    const tokens = Array.from(new Set([name, ...aliases].flatMap((n) => norm(n).split(" ")).filter((t) => t.length >= 4 && !["arena", "stadium", "center", "centre", "hotel", "street", "the", "park", "hall"].includes(t))));
    for (const im of r.items) {
      if (images.some((x) => x.url === im.url)) continue;
      // search results must actually name the candidate (category members are trusted)
      if (!a.category && tokens.length && !tokens.some((t) => norm(im.title).includes(t))) continue;
      const src = makeSource({
        title: im.title,
        url: im.url,
        provider: "wikimedia-commons",
        publisher: "Wikimedia Commons",
        category: "images",
        type: "image",
        excerpt: `${im.license || "see license on page"}${im.author ? ` · ${im.author}` : ""}`,
        reliability: { tier: "secondary", note: "Reference photo; caption and category are community-supplied." },
        why: `Reference photo retrieved to visually compare against candidate ${name}.`,
      });
      d.sources.push(src);
      images.push({ candidateName: name, title: im.title, url: im.url, thumb: im.thumb, license: im.license, sourceId: src.id });
    }
    if (images.length >= 8) break;
  }
  return { ...d, images: images.slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Falsification / disconfirmation searches
// ---------------------------------------------------------------------------

export async function verifyCandidates(req: VerifyRequest, ctx: ProviderContext): Promise<ResearchDelta> {
  const d = emptyDelta();
  const jobs: SearchRequest[] = [];
  for (const c of req.candidates.slice(0, 2)) {
    if (req.kinds.includes("web")) {
      jobs.push({ kind: "web", branch: "falsification", query: `${c.name} renovation renamed history` });
      if (c.teamName) jobs.push({ kind: "web", branch: "falsification", query: `${c.teamName} neutral site games ${req.yearHint || ""}`.trim() });
      if (c.kind === "venue") jobs.push({ kind: "web", branch: "falsification", query: `${c.name} court floor design` });
    }
    if (req.kinds.includes("news")) jobs.push({ kind: "news", branch: "news", query: `"${c.name}"` });
    if (req.kinds.includes("videos")) jobs.push({ kind: "videos", branch: "videos", query: `${c.name} ${c.teamName || ""} ${req.yearHint || ""}`.trim() });
    if (req.kinds.includes("history")) jobs.push({ kind: "history", branch: "history", query: c.name });
  }
  const outs = await pLimit(jobs.slice(0, 7), 3, (j) => runSearch(j, ctx).catch(() => emptyDelta()));
  for (const o of outs) {
    d.queries.push(...o.queries);
    d.results.push(...o.results);
    d.sources.push(...o.sources);
  }
  return d;
}

export type { SearchQuery, SearchResult, Source };
