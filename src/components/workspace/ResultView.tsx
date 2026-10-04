"use client";
import { AlertTriangle, ArrowRight, BookMarked, Check, ExternalLink, HelpCircle, MessageSquare, Network, Play, Sparkles, XCircle } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Button, ConfidenceBadge, Empty, KindBadge, Label, Panel, StrengthDots, cn } from "@/components/ui";
import { StaticMap, mapsLinks } from "@/components/StaticMap";
import { imageUrl, proxied } from "@/lib/client/api";

export function ResultView() {
  const inv = useWorkspace((s) => s.inv)!;
  const running = useWorkspace((s) => s.running);
  const c = inv.conclusion;
  if (!c)
    return (
      <Empty icon={<Sparkles className="size-7" />} title={running ? "Investigation in progress" : "No result yet"}>
        {running ? "Clues, candidates and evidence will appear as research proceeds. Open the cinematic view to watch it unfold." : "Start the investigation to extract clues, research public sources and build the case."}
        {!running && inv.images.length > 0 && (
          <div className="mt-4">
            <Button variant="primary" onClick={() => ws.start({ mode: inv.mode })}>
              <Play className="size-4" /> Start investigation
            </Button>
          </div>
        )}
      </Empty>
    );
  const lead = inv.candidates.find((x) => x.id === c.candidateId);
  const loc = lead && inv.locations.find((l) => l.id === lead.locationId);
  const leadEv = lead ? inv.evidence.filter((e) => e.candidateId === lead.id) : [];
  const supports = leadEv.filter((e) => e.polarity === "supports");
  const bestRef = lead?.images.filter((i) => i.comparison).sort((a, b) => (b.comparison!.embedding ?? 0) - (a.comparison!.embedding ?? 0))[0];
  const alts = inv.candidates.filter((x) => x.id !== c.candidateId).slice(0, 5);
  const links = loc ? mapsLinks(loc.lat, loc.lng, lead?.name) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div className="overflow-hidden rounded-card border border-line-strong bg-gradient-to-br from-panel-2 to-panel">
        <div className="grid gap-0 lg:grid-cols-[1.25fr_1fr]">
          <div className="p-6 md:p-8">
            <div className="label-mono text-signal">Investigation result</div>
            <h2 className="mt-2 text-[clamp(22px,3vw,34px)] font-semibold leading-tight tracking-tight">{c.headline}</h2>
            {lead && <div className="mt-1 text-[13.5px] text-dim">{[lead.address || lead.description, lead.country && !(lead.address || lead.description || "").includes(lead.country) ? lead.country : null].filter(Boolean).join(" · ")}</div>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ConfidenceBadge value={c.confidence} />
              {inv.demo && <span className="label-mono rounded-[3px] border border-warn/40 px-1.5 py-0.5 !text-[9.5px] text-warn">Demo · public sample data</span>}
            </div>
            <p className="mt-5 text-[14px] leading-relaxed text-fg/90">{c.explanation}</p>
            <div className="label-mono mt-2 !text-[9px] text-mute">{c.generatedBy === "ai" ? "Explanation written by AI from stored evidence only" : "Rules-based explanation from the evidence graph"}</div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="outline" className="border-cyan/40 text-cyan" onClick={() => ws.set({ tab: "sources" })}>
                <BookMarked className="size-4" /> View all sources ({inv.sources.length})
              </Button>
              <Button onClick={() => ws.set({ tab: "board" })}>
                <Network className="size-4" /> Open evidence board
              </Button>
              <Button variant="ghost" onClick={() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message TRACE AI"]')?.focus()}>
                <MessageSquare className="size-4" /> Ask TRACE AI
              </Button>
            </div>
          </div>
          <div className="border-t border-line p-4 lg:border-l lg:border-t-0">
            {loc ? (
              <>
                <StaticMap lat={loc.lat} lng={loc.lng} zoom={15} height={230} markers={[{ lat: loc.lat, lng: loc.lng }]} />
                <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-dim">
                  <span>
                    {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                  </span>
                  <span className="flex gap-2">
                    <a className="text-cyan hover:underline" href={links!.googleCoords} target="_blank" rel="noreferrer">
                      Open in Google Maps
                    </a>
                    <a className="text-cyan hover:underline" href={links!.osm} target="_blank" rel="noreferrer">
                      OSM
                    </a>
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => ws.set({ tab: "map" })}>
                  Interactive map <ArrowRight className="size-3" />
                </Button>
              </>
            ) : (
              <div className="grid h-[230px] place-items-center rounded-[4px] border border-dashed border-line text-[12.5px] text-mute">No map location for this result</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Why">
          <ul className="space-y-2.5 p-4">
            {(supports.length ? supports : c.reasons.map((r) => ({ id: r, statement: r, kind: "inference" as const, strength: "moderate" as const }))).slice(0, 8).map((e) => (
              <li key={e.id} className="flex gap-2.5 text-[13px] leading-relaxed">
                <Check className="mt-0.5 size-4 shrink-0 text-ok" />
                <div className="min-w-0 flex-1">
                  <div>{e.statement}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <KindBadge kind={e.kind} />
                    <StrengthDots value={e.strength} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Uncertainty & what could make this wrong">
          <ul className="space-y-2.5 p-4">
            {c.uncertainties.length === 0 && <li className="text-[13px] text-mute">No specific uncertainties recorded.</li>}
            {c.uncertainties.map((u, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-dim">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                {u.replace(/^⚠ /, "")}
              </li>
            ))}
          </ul>
          {lead?.falsification && (
            <div className="border-t border-line p-4">
              <Label className="mb-2">Disproof checks on the leading candidate</Label>
              <ul className="space-y-1.5">
                {lead.falsification.map((f, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px]">
                    {f.outcome === "passed" ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok" /> : f.outcome === "failed" ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-alert" /> : <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-warn" />}
                    <div>
                      <div className="text-fg/90">{f.question}</div>
                      <div className="text-mute">{f.result}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Visual comparison" actions={lead && <Button size="sm" variant="ghost" onClick={() => ws.set({ tab: "compare", selectedCandidateId: lead.id })}>Open compare</Button>}>
          {bestRef && inv.images[0] ? (
            <div className="grid grid-cols-2 gap-px bg-line">
              <figure className="bg-panel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(inv.images[0].key)} alt="Uploaded image" className="aspect-[4/3] w-full object-cover" />
                <figcaption className="label-mono px-3 py-2 !text-[9px] text-mute">Uploaded image</figcaption>
              </figure>
              <figure className="bg-panel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proxied(bestRef.thumb)} alt={bestRef.title} className="aspect-[4/3] w-full object-cover" />
                <figcaption className="px-3 py-2">
                  <div className="label-mono !text-[9px] text-cyan">{bestRef.comparison!.overall === "none" ? "No meaningful resemblance" : `${bestRef.comparison!.overall} visual similarity`}</div>
                  <div className="truncate text-[11.5px] text-mute">{bestRef.title}</div>
                </figcaption>
              </figure>
            </div>
          ) : (
            <div className="p-4 text-[13px] text-mute">No reference photographs were compared for the leading candidate.</div>
          )}
          {bestRef?.comparison?.notes.length ? <div className="border-t border-line px-4 py-2.5 text-[12px] text-dim">{bestRef.comparison.notes.join(" · ")}</div> : null}
        </Panel>
        <Panel title="Alternative possibilities">
          <ul className="divide-y divide-line">
            {alts.length === 0 && <li className="p-4 text-[13px] text-mute">No alternatives were generated.</li>}
            {alts.map((a) => (
              <li key={a.id}>
                <button onClick={() => ws.set({ tab: "candidates", selectedCandidateId: a.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]">
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate text-[13px]", a.status === "rejected" && "text-mute line-through")}>{a.name}</div>
                    <div className="truncate text-[11.5px] text-mute">{a.status === "rejected" ? a.rejectionReason : a.against[0] || [a.city, a.country].filter(Boolean).join(", ")}</div>
                  </div>
                  <ConfidenceBadge value={a.confidence} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {inv.contradictions.length > 0 && (
        <Panel title={`⚠ Contradictions (${inv.contradictions.length})`}>
          <ul className="divide-y divide-line">
            {inv.contradictions.map((x) => (
              <li key={x.id} className="px-4 py-3 text-[13px]">
                <div className="font-medium text-warn">
                  {x.subject} — {x.property}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {x.claims.map((cl, i) => {
                    const s = inv.sources.find((y) => y.id === cl.sourceId);
                    return (
                      <a key={i} href={s?.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[3px] border border-line-strong px-2 py-0.5 text-[12px] hover:border-cyan/40">
                        <span className="font-mono font-semibold">{cl.value}</span> <span className="text-mute">{s?.publisher}</span> <ExternalLink className="size-3 text-mute" />
                      </a>
                    );
                  })}
                </div>
                <div className="mt-1 text-[12px] text-mute">{x.note}</div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {c.nextSteps.length > 0 && (
        <Panel title="What you can investigate next">
          <ul className="grid gap-2 p-4 sm:grid-cols-2">
            {c.nextSteps.map((n, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-dim">
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-cyan" />
                {n}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
