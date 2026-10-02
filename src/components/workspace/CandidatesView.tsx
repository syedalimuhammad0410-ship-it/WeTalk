"use client";
import { useEffect } from "react";
import { Check, ExternalLink, HelpCircle, MapPin, XCircle } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Button, ConfidenceBadge, Empty, KindBadge, Label, StrengthDots, cn } from "@/components/ui";
import { proxied } from "@/lib/client/api";
import type { Candidate, CandidateSignals } from "@/lib/types";

const SIG_LABEL: Record<keyof CandidateSignals, string> = {
  text: "Text similarity",
  logo: "Logo / branding",
  link: "Entity link",
  visual: "Visual similarity",
  geo: "Geographic consistency",
  temporal: "Temporal consistency",
  source: "Source support",
  exif: "Photo GPS",
};

function sigWord(v: number | null) {
  if (v === null) return { w: "not assessed", c: "text-mute" };
  if (v < 0) return { w: "contradicts", c: "text-alert" };
  if (v >= 0.8) return { w: "strong", c: "text-ok" };
  if (v >= 0.5) return { w: "moderate", c: "text-cyan" };
  if (v > 0) return { w: "weak", c: "text-warn" };
  return { w: "none", c: "text-mute" };
}

export function CandidatesView() {
  const inv = useWorkspace((s) => s.inv)!;
  const sel = useWorkspace((s) => s.selectedCandidateId);
  useEffect(() => {
    if (sel) document.getElementById(`cand-${sel}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sel]);
  if (!inv.candidates.length) return <Empty icon={<MapPin className="size-7" />} title="No candidates yet">Candidates appear once clues resolve to entities, places or GPS metadata.</Empty>;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <p className="text-[12.5px] text-dim">Candidates are ranked internally by evidence strength. Evidence for and against each one is shown in full, and nothing contradicting is hidden.</p>
      {inv.candidates.map((c, i) => (
        <CandidateCard key={c.id} c={c} n={i + 1} highlight={sel === c.id} />
      ))}
    </div>
  );
}

function CandidateCard({ c, n, highlight }: { c: Candidate; n: number; highlight: boolean }) {
  const inv = useWorkspace((s) => s.inv)!;
  const ev = inv.evidence.filter((e) => e.candidateId === c.id);
  const loc = inv.locations.find((l) => l.id === c.locationId);
  const srcs = inv.sources.filter((s) => c.sourceIds.includes(s.id));
  return (
    <article id={`cand-${c.id}`} className={cn("overflow-hidden rounded-card border bg-panel", c.status === "leading" ? "border-signal/50" : highlight ? "border-cyan/50" : "border-line", c.status === "rejected" && "opacity-75")}>
      <header className="flex flex-wrap items-start gap-3 border-b border-line p-4">
        <div className="font-mono text-[12px] text-mute">#{n}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("text-[16px] font-semibold", c.status === "rejected" && "line-through decoration-alert/60")}>{c.name}</h3>
            {c.status === "leading" && <span className="label-mono rounded-[3px] bg-signal/15 px-1.5 py-0.5 !text-[9px] text-signal">Leading</span>}
            {c.status === "rejected" && <span className="label-mono rounded-[3px] bg-alert/15 px-1.5 py-0.5 !text-[9px] text-alert">Rejected</span>}
            <ConfidenceBadge value={c.confidence} />
          </div>
          <div className="mt-0.5 text-[12.5px] text-dim">{[c.description, c.city, c.country].filter(Boolean).join(" · ")}</div>
          {c.names.length > 1 && <div className="mt-1 text-[11.5px] text-mute">Also known as: {c.names.filter((x) => x.name !== c.name).map((x) => `${x.name}${x.from || x.to ? ` (${x.from || "?"}–${x.to || "?"})` : ""}`).join(", ")}</div>}
          {c.rejectionReason && <div className="mt-1 text-[12px] text-alert">Rejected: {c.rejectionReason}</div>}
        </div>
        <div className="flex gap-1">
          {loc && (
            <Button size="sm" variant="ghost" onClick={() => ws.set({ tab: "map", selectedCandidateId: c.id })}>
              <MapPin className="size-3.5" /> Map
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => ws.set({ tab: "compare", selectedCandidateId: c.id })}>
            Compare
          </Button>
        </div>
      </header>
      <div className="grid gap-px bg-line md:grid-cols-2">
        <div className="bg-panel p-4">
          <Label className="mb-2">Why it matches</Label>
          <ul className="space-y-1.5">
            {c.why.length === 0 && <li className="text-[12.5px] text-mute">No supporting evidence.</li>}
            {c.why.map((w, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
                <Check className="mt-0.5 size-3.5 shrink-0 text-ok" /> {w}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-panel p-4">
          <Label className="mb-2">Why it might not match</Label>
          <ul className="space-y-1.5">
            {c.against.length === 0 && <li className="text-[12.5px] text-mute">Nothing contradicting found yet — absence of contrary evidence is not proof.</li>}
            {c.against.map((w, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-dim">
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-warn" /> {w.replace(/^⚠ /, "")}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid gap-px border-t border-line bg-line md:grid-cols-[1fr_1.4fr]">
        <div className="bg-panel p-4">
          <Label className="mb-2">Signals (plain language)</Label>
          <dl className="space-y-1">
            {(Object.keys(SIG_LABEL) as (keyof CandidateSignals)[]).map((k) => {
              const s = sigWord(c.signals[k]);
              return (
                <div key={k} className="flex justify-between text-[12px]">
                  <dt className="text-dim">{SIG_LABEL[k]}</dt>
                  <dd className={s.c}>{s.w}</dd>
                </div>
              );
            })}
            <div className="flex justify-between text-[12px]">
              <dt className="text-dim">Sources</dt>
              <dd>{srcs.length}</dd>
            </div>
          </dl>
          {c.confidenceReasons.length > 0 && <p className="mt-3 text-[11.5px] leading-relaxed text-mute">{c.confidenceReasons.join(" ")}</p>}
        </div>
        <div className="bg-panel p-4">
          <Label className="mb-2">Evidence ({ev.length})</Label>
          <ul className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
            {ev.map((e) => (
              <li key={e.id} className="rounded-[4px] border border-line p-2">
                <div className="mb-1 flex items-center gap-2">
                  <KindBadge kind={e.kind} />
                  <span className={cn("label-mono !text-[9px]", e.polarity === "supports" ? "text-ok" : e.polarity === "contradicts" ? "text-alert" : "text-mute")}>{e.polarity}</span>
                  <StrengthDots value={e.strength} />
                </div>
                <div className="text-[12px] leading-relaxed">{e.statement}</div>
                {e.sourceIds.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.sourceIds.map((id) => {
                      const s = inv.sources.find((x) => x.id === id);
                      return s ? (
                        <a key={id} href={s.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate text-[10.5px] text-cyan hover:underline">
                          {s.publisher} <ExternalLink className="size-2.5" />
                        </a>
                      ) : null;
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {c.falsification && (
        <div className="border-t border-line p-4">
          <Label className="mb-2">False-positive protection: what would show this is not the place?</Label>
          <ul className="grid gap-1.5 md:grid-cols-2">
            {c.falsification.map((f, i) => (
              <li key={i} className="flex gap-2 text-[12px]">
                {f.outcome === "passed" ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok" /> : f.outcome === "failed" ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-alert" /> : <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-warn" />}
                <span>
                  <span className="text-fg/90">{f.question}</span> <span className="text-mute">— {f.result}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-line p-3">
          {c.images.map((im) => (
            <a key={im.id} href={im.url} target="_blank" rel="noreferrer" className="relative shrink-0 overflow-hidden rounded-[3px] border border-line" title={`${im.title}${im.license ? ` · ${im.license}` : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxied(im.thumb)} alt={im.title} loading="lazy" className="h-20 w-28 object-cover" />
              {im.comparison && <span className="label-mono absolute bottom-0 left-0 bg-black/80 px-1 !text-[8px] text-cyan">{im.comparison.overall}</span>}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
