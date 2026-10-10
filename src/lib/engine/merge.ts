import type { Investigation } from "@/lib/types";
import type { ResearchDelta } from "./protocol";
import { compact, uniqBy } from "@/lib/util";

/** Merge a research delta into an investigation (dedupes sources by URL and remaps references). */
export function mergeDelta(inv: Investigation, d: Partial<ResearchDelta>): Investigation {
  const next: Investigation = structuredClone(inv);
  const remap = new Map<string, string>();
  const byUrl = new Map(next.sources.map((s) => [s.url, s]));
  const newSources = [];
  for (const s of d.sources || []) {
    const existing = byUrl.get(s.url);
    if (existing) {
      remap.set(s.id, existing.id);
      existing.supports = Array.from(new Set([...existing.supports, ...s.supports]));
      existing.usedInReasoning = existing.usedInReasoning || s.usedInReasoning;
      if (!existing.why && s.why) existing.why = s.why;
    } else {
      byUrl.set(s.url, s);
      newSources.push(s);
    }
  }
  const candRemap = new Map<string, string>();
  const fix = (ids: string[]) => Array.from(new Set(ids.map((i) => remap.get(i) || i)));
  next.sources = [...next.sources, ...newSources];
  next.queries = [...next.queries, ...(d.queries || [])];
  next.results = [...next.results, ...(d.results || []).map((r) => ({ ...r, sourceId: r.sourceId ? remap.get(r.sourceId) || r.sourceId : undefined }))];
  if (d.locations?.length) next.locations = uniqBy([...next.locations, ...d.locations.map((l) => ({ ...l, sourceIds: fix(l.sourceIds) }))], (l) => `${l.name}|${l.lat.toFixed(4)}|${l.lng.toFixed(4)}`);
  if (d.entities?.length) {
    const ents = [...next.entities];
    for (const e of d.entities) {
      const prev = ents.find((x) => (e.wikidataId && x.wikidataId === e.wikidataId) || compact(x.name) === compact(e.name));
      if (prev) {
        prev.detectedBecause = Array.from(new Set([...prev.detectedBecause, ...e.detectedBecause]));
        prev.clueIds = Array.from(new Set([...prev.clueIds, ...e.clueIds]));
        prev.sourceIds = fix([...prev.sourceIds, ...e.sourceIds]);
      } else ents.push({ ...e, sourceIds: fix(e.sourceIds) });
    }
    next.entities = ents;
  }
  if (d.candidates?.length) {
    const cands = [...next.candidates];
    for (const c of d.candidates) {
      const loc = next.locations.find((l) => l.id === c.locationId);
      const prev = cands.find(
        (x) =>
          (c.wikidataId && x.wikidataId === c.wikidataId) ||
          (compact(x.name) === compact(c.name) && (() => {
            const pl = next.locations.find((l) => l.id === x.locationId);
            return !pl || !loc || (Math.abs(pl.lat - loc.lat) < 0.01 && Math.abs(pl.lng - loc.lng) < 0.01);
          })()),
      );
      if (prev) {
        candRemap.set(c.id, prev.id);
        prev.why = Array.from(new Set([...prev.why, ...c.why]));
        prev.sourceIds = fix([...prev.sourceIds, ...c.sourceIds]);
        prev.derivedFrom = Array.from(new Set([...prev.derivedFrom, ...c.derivedFrom]));
        if (!prev.locationId) prev.locationId = c.locationId;
        if (!prev.commonsCategory) prev.commonsCategory = c.commonsCategory;
        if (c.names.length > prev.names.length) prev.names = c.names;
        prev.activeFrom ??= c.activeFrom;
        prev.activeTo ??= c.activeTo;
      } else cands.push({ ...c, sourceIds: fix(c.sourceIds), images: c.images.map((i) => ({ ...i, sourceId: remap.get(i.sourceId) || i.sourceId })) });
    }
    next.candidates = cands;
  }
  if (d.dossiers?.length) {
    const prev = next.dossiers || [];
    const fresh = d.dossiers
      .map((x) => ({ ...x, sourceIds: fix(x.sourceIds), newsIds: fix(x.newsIds), facts: x.facts.map((f) => ({ ...f, sourceId: remap.get(f.sourceId) || f.sourceId })) }))
      .filter((x) => !prev.some((p) => (x.wikidataId && p.wikidataId === x.wikidataId) || compact(p.name) === compact(x.name)));
    next.dossiers = [...prev, ...fresh];
  }
  if (d.timeline?.length) next.timeline = uniqBy([...next.timeline, ...d.timeline.map((t) => ({ ...t, candidateId: t.candidateId ? candRemap.get(t.candidateId) || t.candidateId : undefined, sourceIds: fix(t.sourceIds) }))], (t) => `${t.date}|${compact(t.label)}`);
  if (d.contradictions?.length)
    next.contradictions = uniqBy(
      [...next.contradictions, ...d.contradictions.map((c) => ({ ...c, claims: c.claims.map((cl) => ({ ...cl, sourceId: remap.get(cl.sourceId) || cl.sourceId })) }))],
      (c) => `${compact(c.subject)}|${c.property}|${c.claims.map((x) => x.value).join(",")}`,
    );
  return next;
}
