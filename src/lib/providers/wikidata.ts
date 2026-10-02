import "server-only";
import { fetchJson } from "@/lib/server/http";
import { compact } from "@/lib/util";

const API = "https://www.wikidata.org/w/api.php";
const DAY = 86400;

export interface WDSearchHit {
  id: string;
  label: string;
  description?: string;
  matchText?: string;
}

export interface Dated<T> {
  value: T;
  from?: string;
  to?: string;
  refs: number;
}

export interface WDEntity {
  id: string;
  url: string;
  label: string;
  description: string;
  aliases: string[];
  instanceOf: string[];
  coord?: { lat: number; lng: number };
  inception: Dated<string>[];
  opened: Dated<string>[];
  closed: Dated<string>[];
  dissolved: Dated<string>[];
  officialNames: Dated<string>[];
  homeVenues: Dated<string>[];
  occupants: Dated<string>[];
  hq: string[];
  locatedIn: string[];
  country: string[];
  address?: string;
  websites: Dated<string>[];
  image?: string;
  commonsCategory?: string;
  sport: string[];
  league: string[];
  enwiki?: string;
}

type Snak = { datavalue?: { value: unknown }; snaktype: string };
type Claim = { mainsnak: Snak; qualifiers?: Record<string, Snak[]>; references?: unknown[]; rank: string };

function timeVal(v: unknown): string | undefined {
  const t = (v as { time?: string; precision?: number })?.time;
  if (!t) return undefined;
  const prec = (v as { precision: number }).precision;
  const m = t.match(/^([+-]\d+)-(\d\d)-(\d\d)/);
  if (!m) return undefined;
  const y = String(Number(m[1]));
  if (prec <= 9 || m[2] === "00") return y;
  if (prec === 10 || m[3] === "00") return `${y}-${m[2]}`;
  return `${y}-${m[2]}-${m[3]}`;
}

function idVal(v: unknown) {
  return (v as { id?: string })?.id;
}

function claims(e: { claims?: Record<string, Claim[]> }, p: string): Claim[] {
  return (e.claims?.[p] || []).filter((c) => c.rank !== "deprecated" && c.mainsnak.snaktype === "value");
}

function dated<T>(e: { claims?: Record<string, Claim[]> }, p: string, map: (v: unknown) => T | undefined): Dated<T>[] {
  return claims(e, p)
    .map((c) => {
      const value = map(c.mainsnak.datavalue?.value);
      if (value === undefined) return null;
      return {
        value,
        from: timeVal(c.qualifiers?.P580?.[0]?.datavalue?.value),
        to: timeVal(c.qualifiers?.P582?.[0]?.datavalue?.value),
        refs: c.references?.length || 0,
      };
    })
    .filter(Boolean) as Dated<T>[];
}

export async function searchEntities(text: string, limit = 5): Promise<WDSearchHit[]> {
  const { data } = await fetchJson<{ search?: { id: string; label: string; description?: string; match?: { text: string } }[] }>(
    `${API}?action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=${limit}&search=${encodeURIComponent(text)}`,
    { provider: "wikidata", op: "search", cacheTtl: 7 * DAY },
  );
  return (data.search || []).map((s) => ({ id: s.id, label: s.label, description: s.description, matchText: s.match?.text }));
}

export async function getEntities(ids: string[]): Promise<Record<string, WDEntity>> {
  const out: Record<string, WDEntity> = {};
  const unique = Array.from(new Set(ids.filter((i) => /^Q\d+$/.test(i))));
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const { data } = await fetchJson<{ entities: Record<string, Record<string, unknown>> }>(
      `${API}?action=wbgetentities&format=json&languages=en&props=labels|descriptions|aliases|claims|sitelinks&sitefilter=enwiki&ids=${chunk.join("|")}`,
      { provider: "wikidata", op: "entities", cacheTtl: 7 * DAY, timeoutMs: 10000 },
    );
    for (const [id, raw] of Object.entries(data.entities || {})) {
      const e = raw as {
        labels?: { en?: { value: string } };
        descriptions?: { en?: { value: string } };
        aliases?: { en?: { value: string }[] };
        claims?: Record<string, Claim[]>;
        sitelinks?: { enwiki?: { title: string } };
        missing?: string;
      };
      if (e.missing !== undefined) continue;
      const coordRaw = claims(e, "P625")[0]?.mainsnak.datavalue?.value as { latitude: number; longitude: number } | undefined;
      out[id] = {
        id,
        url: `https://www.wikidata.org/wiki/${id}`,
        label: e.labels?.en?.value || id,
        description: e.descriptions?.en?.value || "",
        aliases: (e.aliases?.en || []).map((a) => a.value),
        instanceOf: claims(e, "P31").map((c) => idVal(c.mainsnak.datavalue?.value)).filter(Boolean) as string[],
        coord: coordRaw ? { lat: coordRaw.latitude, lng: coordRaw.longitude } : undefined,
        inception: dated(e, "P571", timeVal),
        opened: dated(e, "P1619", timeVal),
        closed: dated(e, "P3999", timeVal),
        dissolved: dated(e, "P576", timeVal),
        officialNames: dated(e, "P1448", (v) => (v as { text?: string })?.text),
        homeVenues: dated(e, "P115", idVal),
        occupants: dated(e, "P466", idVal),
        hq: claims(e, "P159").map((c) => idVal(c.mainsnak.datavalue?.value)).filter(Boolean) as string[],
        locatedIn: claims(e, "P131").map((c) => idVal(c.mainsnak.datavalue?.value)).filter(Boolean) as string[],
        country: claims(e, "P17").map((c) => idVal(c.mainsnak.datavalue?.value)).filter(Boolean) as string[],
        address: (claims(e, "P6375")[0]?.mainsnak.datavalue?.value as { text?: string })?.text,
        websites: dated(e, "P856", (v) => (typeof v === "string" ? v : undefined)),
        image: claims(e, "P18")[0]?.mainsnak.datavalue?.value as string | undefined,
        commonsCategory: claims(e, "P373")[0]?.mainsnak.datavalue?.value as string | undefined,
        sport: claims(e, "P641").map((c) => idVal(c.mainsnak.datavalue?.value)).filter(Boolean) as string[],
        league: claims(e, "P118").map((c) => idVal(c.mainsnak.datavalue?.value)).filter(Boolean) as string[],
        enwiki: e.sitelinks?.enwiki?.title,
      };
    }
  }
  return out;
}

export async function getLabels(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = Array.from(new Set(ids.filter((i) => /^Q\d+$/.test(i))));
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const { data } = await fetchJson<{ entities: Record<string, { labels?: { en?: { value: string } } }> }>(
      `${API}?action=wbgetentities&format=json&languages=en&props=labels&ids=${chunk.join("|")}`,
      { provider: "wikidata", op: "labels", cacheTtl: 30 * DAY },
    );
    for (const [id, e] of Object.entries(data.entities || {})) out[id] = e.labels?.en?.value || id;
  }
  return out;
}

/**
 * Name history. Uses P1448 (official name) qualifiers when present; otherwise
 * derives validity windows for aliases from dated official websites whose domain
 * contains the alias (e.g. philipsarena.com valid until 2018-08-29).
 */
export function nameHistory(e: WDEntity): { name: string; from?: string; to?: string; basis: string }[] {
  const names: { name: string; from?: string; to?: string; basis: string }[] = [];
  for (const n of e.officialNames) names.push({ name: n.value, from: n.from, to: n.to, basis: "Wikidata official name (P1448)" });
  const seen = new Set(names.map((n) => compact(n.name)));
  for (const a of [e.label, ...e.aliases]) {
    const c = compact(a);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const site = e.websites.find((w) => {
      try {
        return compact(new URL(w.value).hostname).includes(c);
      } catch {
        return false;
      }
    });
    names.push({
      name: a,
      from: site?.from,
      to: site?.to,
      basis: site && (site.from || site.to) ? `dated official website ${site.value}` : a === e.label ? "current Wikidata label" : "Wikidata alias (undated)",
    });
  }
  return names;
}

export type EntityClass =
  | "sports_team"
  | "venue"
  | "building"
  | "city"
  | "country"
  | "region"
  | "street"
  | "organization"
  | "brand"
  | "publication"
  | "event"
  | "university"
  | "hotel"
  | "restaurant"
  | "public_figure"
  | "other";

/** Classifies a Wikidata hit using its English description (robust across P31 variants). */
export function classify(description = "", label = ""): EntityClass {
  const d = description.toLowerCase();
  if (/\bseason\b/.test(d) || /\bseason\b/i.test(label)) return "event";
  if (/\b(team|club|franchise)\b/.test(d) && /(basketball|football|soccer|baseball|hockey|sports|rugby|cricket|volleyball|athletic)/.test(d)) return "sports_team";
  if (/\b(arena|stadium|ballpark|coliseum|field house|sports venue|indoor venue|velodrome|gymnasium|racecourse|speedway)\b/.test(d)) return "venue";
  if (/\b(hotel|motel|resort|inn)\b/.test(d)) return "hotel";
  if (/\b(restaurant|diner|cafe|café|bakery|bar|pub|eatery|deli)\b/.test(d)) return "restaurant";
  if (/\b(university|college|school|academy|institute of technology)\b/.test(d)) return "university";
  if (/\b(street|avenue|road|boulevard|thoroughfare|highway|square|plaza)\b/.test(d)) return "street";
  if (/\b(building|skyscraper|tower|church|cathedral|museum|library|station|airport|bridge|theatre|theater|hall|mall|shopping (centre|center)|monument|landmark|castle|palace|apartment)\b/.test(d)) return "building";
  if (/\b(newspaper|magazine|periodical|journal|publication)\b/.test(d)) return "publication";
  if (/\b(city|town|village|municipality|capital|metropolis|borough|neighbou?rhood|county seat)\b/.test(d)) return "city";
  if (/^(country|sovereign state)/.test(d) || /\bcountry in\b/.test(d)) return "country";
  if (/\b(state of|province|region|county|prefecture)\b/.test(d)) return "region";
  if (/\b(company|corporation|brand|manufacturer|retailer|chain|business|insurance|bank|airline|conglomerate|enterprise)\b/.test(d)) return "organization";
  if (/\b(tournament|championship|season|game|festival|olympics|cup)\b/.test(d)) return "event";
  if (/\b(american|british|canadian|french|german)?\s*(politician|actor|actress|singer|player|athlete|journalist|businessman|writer)\b/.test(d)) return "public_figure";
  if (label && /hotel/i.test(label)) return "hotel";
  return "other";
}

const LEAGUES: Record<string, string[]> = {
  basketball: ["National Basketball Association", "Women's National Basketball Association", "EuroLeague"],
  football: ["National Football League"],
  baseball: ["Major League Baseball"],
  hockey: ["National Hockey League"],
  soccer: ["Premier League", "Major League Soccer", "La Liga", "Serie A", "Bundesliga", "Ligue 1"],
};

/** Current (non-dissolved) teams of the major leagues for a sport, resolved live from Wikidata. */
export async function teamsForSport(sport: string): Promise<{ league: string; leagueId: string; teams: { id: string; label: string }[] }[]> {
  const names = LEAGUES[sport] || [];
  const out: { league: string; leagueId: string; teams: { id: string; label: string }[] }[] = [];
  for (const name of names) {
    const hit = (await searchEntities(name, 1))[0];
    if (!hit) continue;
    const q = `SELECT DISTINCT ?team ?teamLabel WHERE { ?team wdt:P118 wd:${hit.id} . ?team wdt:P31/wdt:P279* wd:Q12973014 . FILTER NOT EXISTS { ?team wdt:P576 ?d } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 80`;
    try {
      const { data } = await fetchJson<{ results: { bindings: { team: { value: string }; teamLabel: { value: string } }[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
        provider: "wikidata-sparql",
        op: "league-teams",
        retries: 2,
        cacheTtl: 30 * DAY,
        timeoutMs: 9000,
        headers: { Accept: "application/sparql-results+json" },
      });
      const teams = data.results.bindings.map((b) => ({ id: b.team.value.split("/").pop()!, label: b.teamLabel.value })).filter((t) => !/^Q\d+$/.test(t.label));
      if (teams.length) out.push({ league: hit.label, leagueId: hit.id, teams });
    } catch {
      /* skip league */
    }
  }
  return out;
}
