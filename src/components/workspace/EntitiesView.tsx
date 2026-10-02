"use client";
import { Boxes, ExternalLink } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Empty, Label, StrengthDots } from "@/components/ui";

export function EntitiesView() {
  const inv = useWorkspace((s) => s.inv)!;
  if (!inv.entities.length) return <Empty icon={<Boxes className="size-7" />} title="No entities yet">Organizations, teams, venues, places, publications and dates are extracted from visible text, logos and AI readings.</Empty>;
  return (
    <div className="mx-auto grid max-w-5xl gap-3 p-4 sm:grid-cols-2 md:p-6">
      {inv.entities.map((e) => {
        const related = inv.candidates.filter((c) => c.derivedFrom.includes(e.name));
        const evs = inv.timeline.filter((t) => related.some((c) => c.id === t.candidateId));
        const wd = inv.sources.find((s) => e.sourceIds.includes(s.id));
        return (
          <article key={e.id} className="rounded-card border border-line bg-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-[15px] font-semibold uppercase tracking-wide">{e.name}</h3>
                <Label className="mt-0.5">{e.type.replace("_", " ")}</Label>
              </div>
              <StrengthDots value={e.matchQuality} />
            </div>
            {e.description && <p className="mt-2 text-[12.5px] text-dim">{e.description}</p>}
            <dl className="mt-3 space-y-1 text-[12px]">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-mute">Detected because</dt>
                <dd>{e.detectedBecause.join("; ")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-mute">Sources</dt>
                <dd>
                  {e.sourceIds.length}{" "}
                  {wd && (
                    <a href={wd.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-cyan hover:underline">
                      {wd.publisher} <ExternalLink className="size-3" />
                    </a>
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-mute">Related locations</dt>
                <dd>
                  {related.length ? (
                    related.map((c, i) => (
                      <button key={c.id} onClick={() => ws.set({ tab: "candidates", selectedCandidateId: c.id })} className="text-cyan hover:underline">
                        {c.name}
                        {i < related.length - 1 ? ", " : ""}
                      </button>
                    ))
                  ) : (
                    <span className="text-mute">none</span>
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-mute">Related events</dt>
                <dd>{evs.length}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
