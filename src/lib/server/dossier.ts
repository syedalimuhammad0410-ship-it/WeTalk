import "server-only";
import type { Dossier, DossierFact, DossierKind, Source } from "@/lib/types";
import type { ResearchDelta } from "@/lib/engine/protocol";
import { nowIso, uid } from "@/lib/util";
import { fetchJson } from "./http";
import type { ProviderContext } from "./settings";
import { makeSource, runSearch } from "./research";
import { getLabels, searchEntities } from "@/lib/providers/wikidata";
import { wikipediaSummary } from "@/lib/providers/search";

// ---------------------------------------------------------------------------
// Subject dossiers: everything public about a company, airline, brand, landmark, meme… seen in an image.
// Every fact comes from a structured source (Wikidata, with Wikipedia and news alongside) — never from the AI.
// ---------------------------------------------------------------------------

type ValueKind = "item" | "time" | "quantity" | "string" | "url" | "handle";
interface PropDef {
  pid: string;
  label: string;
  group: DossierFact["group"];
  kind: ValueKind;
  /** take the newest value (by "point in time" qualifier) instead of listing all */
  latest?: boolean;
  max?: number;
  /** for social handles */
  prefix?: string;
}

const PROPS: PropDef[] = [
  { pid: "P31", label: "Type", group: "overview", kind: "item", max: 3 },
  { pid: "P452", label: "Industry", group: "overview", kind: "item", max: 3 },
  { pid: "P571", label: "Founded", group: "overview", kind: "time" },
  { pid: "P1619", label: "Opened", group: "overview", kind: "time" },
  { pid: "P577", label: "First published", group: "overview", kind: "time" },
  { pid: "P576", label: "Dissolved", group: "overview", kind: "time" },
  { pid: "P749", label: "Parent organization", group: "overview", kind: "item" },
  { pid: "P127", label: "Owned by", group: "overview", kind: "item", max: 3 },
  { pid: "P176", label: "Manufacturer", group: "overview", kind: "item" },
  { pid: "P144", label: "Based on", group: "overview", kind: "item", max: 2 },
  { pid: "P1435", label: "Heritage status", group: "overview", kind: "item", max: 2 },
  { pid: "P118", label: "League", group: "overview", kind: "item" },
  // money (newest figure, with its date)
  { pid: "P2139", label: "Revenue", group: "financials", kind: "quantity", latest: true },
  { pid: "P3362", label: "Operating income", group: "financials", kind: "quantity", latest: true },
  { pid: "P2295", label: "Net profit", group: "financials", kind: "quantity", latest: true },
  { pid: "P2403", label: "Total assets", group: "financials", kind: "quantity", latest: true },
  { pid: "P2137", label: "Total equity", group: "financials", kind: "quantity", latest: true },
  { pid: "P2226", label: "Market capitalization", group: "financials", kind: "quantity", latest: true },
  { pid: "P414", label: "Stock exchange", group: "financials", kind: "item", max: 2 },
  // people
  { pid: "P169", label: "CEO", group: "people", kind: "item", latest: true },
  { pid: "P488", label: "Chairperson", group: "people", kind: "item", latest: true },
  { pid: "P1037", label: "Director / manager", group: "people", kind: "item", latest: true },
  { pid: "P112", label: "Founded by", group: "people", kind: "item", max: 4 },
  { pid: "P170", label: "Created by", group: "people", kind: "item", max: 3 },
  { pid: "P84", label: "Architect", group: "people", kind: "item", max: 3 },
  { pid: "P286", label: "Head coach", group: "people", kind: "item", latest: true },
  // operations
  { pid: "P1128", label: "Employees", group: "operations", kind: "quantity", latest: true },
  { pid: "P113", label: "Airline hubs", group: "operations", kind: "item", max: 6 },
  { pid: "P114", label: "Airline alliance", group: "operations", kind: "item" },
  { pid: "P121", label: "Aircraft operated", group: "operations", kind: "item", max: 8 },
  { pid: "P1056", label: "Products", group: "operations", kind: "item", max: 6 },
  { pid: "P355", label: "Subsidiaries", group: "operations", kind: "item", max: 6 },
  { pid: "P2048", label: "Height", group: "operations", kind: "quantity" },
  { pid: "P1174", label: "Visitors per year", group: "operations", kind: "quantity", latest: true },
  { pid: "P1083", label: "Capacity", group: "operations", kind: "quantity", latest: true },
  // where
  { pid: "P159", label: "Headquarters", group: "location", kind: "item" },
  { pid: "P115", label: "Home venue", group: "location", kind: "item" },
  { pid: "P131", label: "Located in", group: "location", kind: "item" },
  { pid: "P17", label: "Country", group: "location", kind: "item" },
  { pid: "P495", label: "Country of origin", group: "location", kind: "item" },
  // identifiers
  { pid: "P229", label: "IATA code", group: "codes", kind: "string" },
  { pid: "P230", label: "ICAO code", group: "codes", kind: "string" },
  { pid: "P432", label: "Callsign", group: "codes", kind: "string" },
  { pid: "P249", label: "Ticker symbol", group: "codes", kind: "string" },
  { pid: "P946", label: "ISIN", group: "codes", kind: "string" },
  // links
  { pid: "P856", label: "Official website", group: "links", kind: "url" },
  { pid: "P2002", label: "X (Twitter)", group: "links", kind: "handle", prefix: "https://x.com/" },
  { pid: "P2003", label: "Instagram", group: "links", kind: "handle", prefix: "https://www.instagram.com/" },
  { pid: "P2013", label: "Facebook", group: "links", kind: "handle", prefix: "https://www.facebook.com/" },
  { pid: "P4264", label: "LinkedIn", group: "links", kind: "handle", prefix: "https://www.linkedin.com/company/" },
  { pid: "P2397", label: "YouTube", group: "links", kind: "handle", prefix: "https://www.youtube.com/channel/" },
];

/** Wording that fits the subject: a company is "founded", a bridge's construction "started", a meme is "created". */
function labelFor(def: PropDef, kind: DossierKind): string {
  if (def.pid === "P571") return ({ landmark: "Construction started", place: "Established", meme: "Created", artwork: "Created", product: "Introduced", vehicle: "Introduced", event: "First held" } as Partial<Record<DossierKind, string>>)[kind] || "Founded";
  if (def.pid === "P121") return kind === "airline" ? "Aircraft operated" : "Operates";
  return def.label;
}

const CURRENCY: Record<string, string> = { Q4917: "$", Q4916: "€", Q25224: "£", Q8146: "¥", Q39099: "CN¥", Q1104069: "CA$", Q259502: "A$", Q25344: "CHF ", Q80524: "₹", Q173117: "R$", Q4730: "₩", Q41044: "₽", Q4588: "₺", Q200294: "AED ", Q202040: "SAR ", Q188289: "PKR " };
const UNIT_SHORT: Record<string, string> = { Q11573: "m", Q3710: "ft", Q828224: "km", Q712226: "km²", Q11570: "kg" };

interface Snak {
  snaktype: string;
  datavalue?: { value: unknown; type: string };
}
interface Claim {
  rank: "preferred" | "normal" | "deprecated";
  mainsnak: Snak;
  qualifiers?: Record<string, Snak[]>;
}
interface RawEntity {
  labels?: { en?: { value: string } };
  descriptions?: { en?: { value: string } };
  claims?: Record<string, Claim[]>;
  sitelinks?: { enwiki?: { title: string } };
}

const timeOf = (v: unknown) => (v as { time?: string; precision?: number } | undefined) || {};
function fmtTime(v: unknown): string {
  const { time, precision } = timeOf(v);
  if (!time) return "";
  const m = time.match(/^([+-])(\d+)-(\d\d)-(\d\d)/);
  if (!m) return "";
  const y = `${m[1] === "-" ? "-" : ""}${Number(m[2])}`;
  if ((precision ?? 9) <= 9) return y;
  const month = new Date(Date.UTC(2000, Number(m[3]) - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  if (precision === 10) return `${month} ${y}`;
  return `${Number(m[4])} ${month} ${y}`;
}
const sortKey = (v: unknown) => timeOf(v).time?.replace(/^\+/, "") || "";

function bigNumber(n: number) {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2).replace(/\.?0+$/, "")} trillion`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.?0+$/, "")} billion`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")} million`;
  return n.toLocaleString("en-US");
}

/** Wikidata search, biased toward the kind of thing the AI saw (an airline, a meme, a bridge…). */
async function resolve(name: string, kind: DossierKind): Promise<string | null> {
  const hits = await searchEntities(name, 7).catch(() => []);
  if (!hits.length) return null;
  const want: Record<string, RegExp> = {
    airline: /airline|air carrier|aviation/i,
    company: /company|corporation|business|manufacturer|retailer|brand|conglomerate|chain|bank|firm|enterprise|automaker/i,
    brand: /brand|company|corporation|manufacturer|retailer|chain/i,
    organization: /organi[sz]ation|agency|association|federation|institution|company|charity|union/i,
    "sports team": /team|club|franchise/i,
    landmark: /building|bridge|tower|monument|stadium|arena|cathedral|church|museum|palace|statue|landmark|square|park|castle/i,
    place: /city|town|village|country|region|state|province|district|neighbourhood|street|square/i,
    product: /product|model|device|smartphone|console|software|drink|beverage|food|series/i,
    vehicle: /aircraft|airliner|automobile|car model|vehicle|ship|train|locomotive|motorcycle/i,
    meme: /meme|internet|image macro|viral|catchphrase|video/i,
    artwork: /painting|sculpture|artwork|mural|poster|film|album/i,
    event: /event|festival|tournament|championship|ceremony|olympic|cup|race/i,
  };
  const re = want[kind];
  const avoid = /disambiguation|wikimedia|family name|given name|scientific article/i;
  const scored = hits
    .filter((h) => !avoid.test(h.description || ""))
    .map((h, i) => ({ h, s: (re && re.test(h.description || "") ? 10 : 0) + (h.label.toLowerCase() === name.toLowerCase() ? 3 : 0) - i }));
  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.h.id || null;
}

export async function buildDossier(req: { name: string; kind: DossierKind; wikidataId?: string; foundBecause: string }, ctx: ProviderContext): Promise<ResearchDelta & { dossier: Dossier | null }> {
  const d: ResearchDelta = { queries: [], results: [], sources: [], dossiers: [] };
  const qid = req.wikidataId && /^Q\d+$/.test(req.wikidataId) ? req.wikidataId : await resolve(req.name, req.kind);
  const facts: DossierFact[] = [];
  let label = req.name;
  let description: string | undefined;
  let image: string | undefined;
  let website: string | undefined;
  let wikiTitle: string | undefined;
  let wdSrc: Source | null = null;

  if (qid) {
    const { data } = await fetchJson<{ entities: Record<string, RawEntity> }>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en&props=labels|descriptions|claims|sitelinks&sitefilter=enwiki&ids=${qid}`,
      { provider: "wikidata", op: "dossier", cacheTtl: 2 * 86400, timeoutMs: 10000 },
    );
    const e = data.entities?.[qid];
    if (e?.claims) {
      label = e.labels?.en?.value || label;
      description = e.descriptions?.en?.value;
      wikiTitle = e.sitelinks?.enwiki?.title;
      wdSrc = makeSource({
        title: `${label} — Wikidata`,
        url: `https://www.wikidata.org/wiki/${qid}`,
        provider: "wikidata",
        publisher: "Wikidata",
        category: "reference",
        type: "dataset",
        excerpt: description,
        reliability: { tier: "secondary", note: "Community-maintained structured data; figures carry their reporting date." },
        usedInReasoning: true,
      });
      d.sources.push(wdSrc);
      const claimsOf = (pid: string) => (e.claims![pid] || []).filter((c) => c.rank !== "deprecated" && c.mainsnak.snaktype === "value");
      // logo, else main image
      const file = (claimsOf("P154")[0] || claimsOf("P18")[0])?.mainsnak.datavalue?.value;
      if (typeof file === "string") image = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=400`;

      // collect raw values, then resolve every item/unit label in one batch
      type Raw = { def: PropDef; value: unknown; asOf?: unknown; ticker?: string };
      const raw: Raw[] = [];
      for (const def of PROPS) {
        let cs = claimsOf(def.pid);
        if (!cs.length) continue;
        if (def.latest) {
          const when = (c: Claim) => sortKey(c.qualifiers?.P585?.[0]?.datavalue?.value ?? c.qualifiers?.P580?.[0]?.datavalue?.value);
          if (def.kind === "item") {
            // the current officeholder: no end time, most recent start; ranks are often unset for people
            const pool = [...cs].sort((a, b) => when(b).localeCompare(when(a)));
            cs = [pool.find((c) => !c.qualifiers?.P582) || pool[0]];
          } else {
            // newest figure by "point in time"; Wikidata marks the current one "preferred" when maintained
            const pref = cs.filter((c) => c.rank === "preferred");
            const pool = [...(pref.length ? pref : cs)].sort((a, b) => when(b).localeCompare(when(a)));
            cs = [pool[0]];
          }
        }
        for (const c of cs.slice(0, def.max ?? 1)) {
          const ticker = def.pid === "P414" ? (c.qualifiers?.P249?.[0]?.datavalue?.value as string | undefined) : undefined;
          raw.push({ def, value: c.mainsnak.datavalue?.value, asOf: c.qualifiers?.P585?.[0]?.datavalue?.value ?? c.qualifiers?.P580?.[0]?.datavalue?.value, ticker });
        }
      }
      const ids = new Set<string>();
      for (const r of raw) {
        if (r.def.kind === "item") ids.add((r.value as { id?: string })?.id || "");
        if (r.def.kind === "quantity") ids.add(String((r.value as { unit?: string })?.unit || "").split("/").pop() || "");
      }
      const labels = await getLabels([...ids].filter((x) => /^Q\d+$/.test(x)));
      const grouped = new Map<string, string[]>();
      for (const r of raw) {
        let v = "";
        if (r.def.kind === "item") v = labels[(r.value as { id: string }).id] || "";
        else if (r.def.kind === "time") v = fmtTime(r.value);
        else if (r.def.kind === "string") v = String(r.value || "");
        else if (r.def.kind === "url") v = String(r.value || "");
        else if (r.def.kind === "handle") v = r.def.prefix + String(r.value || "");
        else if (r.def.kind === "quantity") {
          const q = r.value as { amount: string; unit: string };
          const n = Number(q.amount);
          const unit = q.unit.split("/").pop() || "";
          if (!Number.isFinite(n)) continue;
          if (CURRENCY[unit]) v = `${CURRENCY[unit]}${bigNumber(n)}`;
          else if (unit === "1" || !unit) v = bigNumber(n);
          else v = `${bigNumber(n)} ${UNIT_SHORT[unit] || labels[unit] || ""}`.trim();
        }
        if (!v || /^Q\d+$/.test(v)) continue;
        if (r.ticker) v = `${v} (${r.ticker})`;
        if (r.def.pid === "P856" && !website) website = v;
        if (r.def.max && r.def.max > 1 && !r.def.latest) {
          grouped.set(r.def.pid, [...(grouped.get(r.def.pid) || []), v]);
          continue;
        }
        // figures carry their reporting date; people carry their start date ("since")
        if (r.def.kind === "item" && r.def.latest && r.asOf) v = `${v} (since ${fmtTime(r.asOf)})`;
        facts.push({ label: labelFor(r.def, req.kind), value: v, asOf: r.def.kind === "quantity" && r.asOf ? fmtTime(r.asOf) : undefined, group: r.def.group, sourceId: wdSrc.id });
      }
      for (const [pid, vals] of grouped) {
        const def = PROPS.find((p) => p.pid === pid)!;
        facts.push({ label: labelFor(def, req.kind), value: Array.from(new Set(vals)).join(", "), group: def.group, sourceId: wdSrc.id });
      }
      // keep the property order stable for display
      const order = (l: string) => PROPS.findIndex((p) => labelFor(p, req.kind) === l);
      facts.sort((a, b) => order(a.label) - order(b.label));
    }
  }

  // plain-language summary
  let summary: string | undefined;
  const wiki = await wikipediaSummary(wikiTitle || label).catch(() => null);
  if (wiki?.extract) {
    summary = wiki.extract;
    image ||= wiki.thumb;
    const s = makeSource({ title: `${wiki.title} — Wikipedia`, url: wiki.url, provider: "wikipedia", publisher: "Wikipedia", category: "reference", type: "webpage", excerpt: wiki.extract.slice(0, 300), reliability: { tier: "tertiary", note: "Encyclopedia summary." }, usedInReasoning: true });
    d.sources.push(s);
  }

  // without a public record or encyclopedia entry there is nothing reliable to profile (e.g. a registration number)
  if (!qid && !summary) return { ...d, dossiers: [], dossier: null };

  // recent news + the latest public reporting (figures in structured data can lag a year or more)
  const year = new Date().getUTCFullYear();
  const searches: { kind: "news" | "web"; query: string }[] = [{ kind: "news", query: label }];
  if (["company", "airline", "brand", "organization"].includes(req.kind)) searches.push({ kind: "web", query: `${label} annual results revenue net profit ${year - 1}` });
  if (req.kind === "meme") searches.push({ kind: "web", query: `${label} meme origin know your meme` });
  if (req.kind === "landmark" || req.kind === "place") searches.push({ kind: "web", query: `${label} history facts` });
  const newsIds: string[] = [];
  await Promise.all(
    searches.map(async (s) => {
      const r = await runSearch({ kind: s.kind, query: s.query, branch: "dossier" }, ctx).catch(() => null);
      if (!r) return;
      d.queries.push(...r.queries);
      d.results.push(...r.results);
      d.sources.push(...r.sources);
      newsIds.push(...r.sources.slice(0, 6).map((x) => x.id));
    }),
  );

  const dossier: Dossier = {
    id: uid("dos"),
    name: label,
    kind: req.kind,
    wikidataId: qid || undefined,
    description,
    summary,
    image,
    website,
    facts,
    newsIds: newsIds.slice(0, 12),
    sourceIds: d.sources.filter((s) => s.provider === "wikidata" || s.provider === "wikipedia").map((s) => s.id),
    foundBecause: req.foundBecause,
    createdAt: nowIso(),
  };
  d.dossiers!.push(dossier);
  return { ...d, dossier };
}
