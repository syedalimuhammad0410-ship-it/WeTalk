"use client";
import { motion } from "motion/react";
import { Building2, ExternalLink, Landmark, Laugh, Newspaper, Plane, Search, Tag } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { proxied } from "@/lib/client/api";
import { Empty, Label, cn } from "@/components/ui";
import type { Dossier, DossierFact } from "@/lib/types";

const KIND_ICON: Record<string, typeof Building2> = { airline: Plane, company: Building2, brand: Tag, organization: Building2, landmark: Landmark, meme: Laugh };
const GROUPS: { id: DossierFact["group"]; label: string }[] = [
  { id: "financials", label: "Financials" },
  { id: "overview", label: "Overview" },
  { id: "people", label: "People" },
  { id: "operations", label: "Operations" },
  { id: "location", label: "Location" },
  { id: "codes", label: "Codes & identifiers" },
];
// the headline figures shown as big tiles when present
const HEADLINE = ["Revenue", "Net profit", "Operating income", "Market capitalization", "Employees", "Headquarters", "CEO", "Founded", "Created", "Opened", "IATA code"];

/** Profiles of the subjects in the image: companies, airlines, brands, landmarks, memes… */
export function DossiersView() {
  const inv = useWorkspace((s) => s.inv)!;
  const running = useWorkspace((s) => s.running);
  const list = inv.dossiers || [];
  if (!list.length)
    return (
      <Empty title={running ? "Researching the subjects in the image…" : "No subjects researched yet"}>
        When the image shows a company, airline, brand, landmark, product or meme, TRACE builds a full profile here: what it is, revenue and profit, headquarters, leadership, codes, history and recent news, each fact with its source.
      </Empty>
    );
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h2 className="text-[17px] font-semibold">Subjects in this image</h2>
        <p className="mt-0.5 text-[12.5px] text-mute">Public profiles built from Wikidata, Wikipedia and current news. Every figure links to its source and shows the date it was reported.</p>
      </div>
      {list.map((d, i) => (
        <DossierCard key={d.id} d={d} index={i} />
      ))}
    </div>
  );
}

function DossierCard({ d, index }: { d: Dossier; index: number }) {
  const inv = useWorkspace((s) => s.inv)!;
  const Icon = KIND_ICON[d.kind] || Search;
  const src = (id: string) => inv.sources.find((s) => s.id === id);
  const headline = HEADLINE.map((l) => d.facts.find((f) => f.label === l)).filter(Boolean) as DossierFact[];
  const links = d.facts.filter((f) => f.group === "links");
  const news = d.newsIds.map(src).filter(Boolean).slice(0, 8);
  return (
    <motion.article initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }} className="overflow-hidden rounded-card border border-line-strong bg-panel">
      <header className="flex gap-4 border-b border-line p-4">
        {d.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={proxied(d.image)} alt="" className="size-20 shrink-0 rounded-[4px] bg-white/90 object-contain p-1.5" loading="lazy" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-mono inline-flex items-center gap-1 rounded-[3px] border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 !text-[9px] text-cyan">
              <Icon className="size-3" /> {d.kind}
            </span>
            {d.wikidataId && <span className="font-mono text-[10px] text-mute">{d.wikidataId}</span>}
          </div>
          <h3 className="mt-1 text-[19px] font-semibold leading-tight">{d.name}</h3>
          {d.description && <div className="text-[12.5px] text-dim">{d.description}</div>}
          <div className="mt-1 text-[11.5px] text-mute">Why researched: {d.foundBecause}</div>
        </div>
      </header>

      {headline.length > 0 && (
        <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
          {headline.slice(0, 8).map((f) => (
            <a key={f.label} href={src(f.sourceId)?.url} target="_blank" rel="noreferrer" className="bg-panel p-3 hover:bg-white/[0.03]">
              <div className="label-mono !text-[9px] text-mute">{f.label}</div>
              <div className={cn("mt-1 font-semibold leading-tight", f.group === "financials" ? "text-[17px] text-signal" : "text-[14px]")}>{f.value}</div>
              {f.asOf && <div className="mt-0.5 text-[10.5px] text-mute">as of {f.asOf}</div>}
            </a>
          ))}
        </div>
      )}

      <div className="grid gap-px bg-line md:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4 bg-panel p-4">
          {d.summary && <p className="text-[13px] leading-relaxed text-dim">{d.summary}</p>}
          {GROUPS.map((g) => {
            const rows = d.facts.filter((f) => f.group === g.id && !headline.includes(f));
            if (!rows.length) return null;
            return (
              <div key={g.id}>
                <Label className="mb-1.5">{g.label}</Label>
                <dl className="divide-y divide-line rounded-[4px] border border-line">
                  {rows.map((f) => (
                    <div key={f.label + f.value} className="flex gap-3 px-2.5 py-1.5 text-[12.5px]">
                      <dt className="w-40 shrink-0 text-mute">{f.label}</dt>
                      <dd className="min-w-0 flex-1">
                        {f.value}
                        {f.asOf && <span className="text-mute"> · as of {f.asOf}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
        <div className="space-y-4 bg-panel p-4">
          {links.length > 0 && (
            <div>
              <Label className="mb-1.5">Official links</Label>
              <div className="flex flex-wrap gap-1.5">
                {links.map((l) => (
                  <a key={l.label} href={l.value} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[4px] border border-line-strong px-2 py-1 text-[11.5px] hover:border-cyan/50">
                    {l.label} <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label className="mb-1.5">
              <Newspaper className="mr-1 inline size-3" /> News & latest reports
            </Label>
            {news.length ? (
              <ul className="space-y-2">
                {news.map((n) => (
                  <li key={n!.id} className="text-[12.5px] leading-snug">
                    <a href={n!.url} target="_blank" rel="noreferrer" className="hover:text-cyan">
                      {n!.title}
                    </a>
                    <div className="text-[11px] text-mute">
                      {n!.publisher}
                      {n!.publishedAt ? ` · ${n!.publishedAt.slice(0, 10)}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-mute">No recent articles found.</p>
            )}
          </div>
          <div>
            <Label className="mb-1.5">Sources</Label>
            <ul className="space-y-0.5 text-[12px]">
              {d.sourceIds.map(src).filter(Boolean).map((s) => (
                <li key={s!.id}>
                  <a href={s!.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                    {s!.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <button onClick={() => ws.set({ tab: "sources" })} className="text-[11.5px] text-mute hover:text-fg">
            See all sources →
          </button>
        </div>
      </div>
    </motion.article>
  );
}
