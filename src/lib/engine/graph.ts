import type { Board, BoardEdge, BoardNode, Investigation } from "@/lib/types";
import { nowIso, truncate } from "@/lib/util";

export type ArrangeMode = "auto" | "location" | "sources" | "timeline";

const COL = { image: 0, clue: 1, entity: 2, candidate: 3, location: 4, source: 5, conclusion: 4, timeline: 3, note: 0, query: 1 };

/**
 * Builds (or refreshes) the automatic evidence graph. Stable node ids (`kind:refId`)
 * let a rebuild keep user-moved positions, pins, notes and manual connections.
 */
export function buildBoard(inv: Investigation, prev?: Board, mode: ArrangeMode = "auto"): Board {
  const nodes: BoardNode[] = [];
  const edges: BoardEdge[] = [];
  const add = (n: Omit<BoardNode, "position" | "type"> & { type?: string }) => {
    if (nodes.some((x) => x.id === n.id)) return;
    nodes.push({ type: n.type || "evidence", position: { x: 0, y: 0 }, ...n });
  };
  const link = (source: string, target: string, label: string, kind: BoardEdge["kind"] = "relates") => {
    if (!nodes.some((n) => n.id === source) || !nodes.some((n) => n.id === target)) return;
    const id = `e:${source}>${target}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, label, kind });
  };

  for (const im of inv.images) add({ id: `image:${im.id}`, data: { kind: "image", title: im.name, subtitle: `${im.width}×${im.height}${im.enhancedFrom ? " · enhanced" : ""}`, refId: im.id, thumb: `/api/images/${im.key}` } });
  const clues = inv.clues.filter((c) => !c.ignored).sort((a, b) => b.weight - a.weight).slice(0, 16);
  for (const c of clues) {
    add({ id: `clue:${c.id}`, data: { kind: "clue", title: truncate(c.value, 40), subtitle: `${c.type.toUpperCase()} · ${c.engine}`, refId: c.id } });
    if (c.imageId) link(`image:${c.imageId}`, `clue:${c.id}`, c.type === "text" ? "contains text" : "shows");
  }
  for (const e of inv.entities.slice(0, 14)) {
    add({ id: `entity:${e.id}`, data: { kind: "entity", title: e.name, subtitle: e.type.replace("_", " "), refId: e.id } });
    for (const cid of e.clueIds) link(`clue:${cid}`, `entity:${e.id}`, "mentions");
  }
  const cands = inv.candidates.slice(0, 10);
  for (const c of cands) {
    add({
      id: `candidate:${c.id}`,
      data: { kind: "candidate", title: c.name, subtitle: `${c.status === "rejected" ? "REJECTED · " : c.status === "leading" ? "LEADING · " : ""}${c.confidence} confidence`, refId: c.id, color: c.status === "leading" ? "accent" : c.status === "rejected" ? "muted" : undefined },
    });
    for (const d of c.derivedFrom) {
      const ent = inv.entities.find((e) => e.name === d);
      if (ent) link(`entity:${ent.id}`, `candidate:${c.id}`, ent.type === "sports_team" ? "played at" : "names");
    }
    const ev = inv.evidence.filter((e) => e.candidateId === c.id);
    for (const e of ev) for (const cid of e.clueIds) link(`clue:${cid}`, `candidate:${c.id}`, e.polarity === "contradicts" ? "contradicts" : "matches", e.polarity === "contradicts" ? "contradicts" : "supports");
    const loc = inv.locations.find((l) => l.id === c.locationId);
    if (loc) {
      add({ id: `location:${loc.id}`, data: { kind: "location", title: loc.name, subtitle: `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`, refId: loc.id } });
      link(`candidate:${c.id}`, `location:${loc.id}`, "located at");
    }
    for (const im of c.images.filter((i) => i.comparison).slice(0, 1)) {
      const nid = `refimg:${im.id}`;
      add({ id: nid, data: { kind: "image", title: truncate(im.title, 36), subtitle: `reference · ${im.comparison!.overall} similarity`, refId: im.id, thumb: `/api/image-proxy?url=${encodeURIComponent(im.thumb)}` } });
      link(nid, `candidate:${c.id}`, "visually resembles", im.comparison!.overall === "none" ? "contradicts" : "supports");
    }
  }
  const usedSources = inv.sources.filter((s) => s.usedInReasoning || s.saved).slice(0, mode === "sources" ? 30 : 12);
  for (const s of usedSources) {
    add({ id: `source:${s.id}`, data: { kind: "source", title: truncate(s.title, 44), subtitle: `${s.category} · ${s.publisher}`, refId: s.id } });
    for (const c of cands) if (c.sourceIds.includes(s.id)) link(`source:${s.id}`, `candidate:${c.id}`, "published by / supports", "supports");
    for (const e of inv.entities) if (e.sourceIds.includes(s.id)) link(`source:${s.id}`, `entity:${e.id}`, "describes");
  }
  if (inv.conclusion) {
    add({ id: "conclusion", data: { kind: "conclusion", title: inv.conclusion.headline, subtitle: `${inv.conclusion.confidence} confidence`, refId: inv.conclusion.candidateId || undefined, color: "accent" } });
    if (inv.conclusion.candidateId) link(`candidate:${inv.conclusion.candidateId}`, "conclusion", "best supported");
  }
  if (mode === "timeline" || inv.timeline.length) {
    const tl = [...inv.timeline].sort((a, b) => a.year - b.year).slice(0, mode === "timeline" ? 30 : 8);
    for (const t of tl) {
      add({ id: `timeline:${t.id}`, data: { kind: "timeline", title: `${t.year}`, subtitle: truncate(t.label, 60), refId: t.id } });
      if (t.candidateId) link(`timeline:${t.id}`, `candidate:${t.candidateId}`, "occurred at");
    }
  }
  for (const n of inv.notes.slice(0, 8)) add({ id: `note:${n.id}`, data: { kind: "note", title: truncate(n.text, 60), subtitle: "your note (user-provided)", refId: n.id } });

  layout(nodes, mode);

  // keep user state from previous board
  if (prev) {
    for (const n of nodes) {
      const p = prev.nodes.find((x) => x.id === n.id);
      if (p) {
        if (mode === "auto" && (p.data.pinned || p.data.moved)) n.position = p.position;
        n.data = { ...n.data, pinned: p.data.pinned, note: p.data.note, color: p.data.userColor ? (p.data.color as string) : n.data.color, userColor: p.data.userColor, moved: mode === "auto" ? p.data.moved : false };
      }
    }
    for (const p of prev.nodes.filter((x) => x.type === "note-card" || x.id.startsWith("manual:"))) nodes.push(p);
    for (const e of prev.edges.filter((x) => x.manual)) if (nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target)) edges.push(e);
  }
  return { id: prev?.id || "board-main", name: prev?.name || "Evidence board", nodes, edges, updatedAt: nowIso() };
}

function layout(nodes: BoardNode[], mode: ArrangeMode) {
  const cols = new Map<number, BoardNode[]>();
  for (const n of nodes) {
    let col = COL[n.data.kind as keyof typeof COL] ?? 2;
    if (n.id === "conclusion") col = 6;
    if (n.id.startsWith("refimg:")) col = 2.5;
    if (mode === "location" && n.data.kind === "location") col = 4;
    if (mode === "sources" && n.data.kind === "source") col = 2;
    if (mode === "timeline" && n.data.kind === "timeline") col = 1.5;
    const arr = cols.get(col) || [];
    arr.push(n);
    cols.set(col, arr);
  }
  const X = 290;
  const Y = 118;
  for (const [col, arr] of cols) {
    const h = arr.length * Y;
    arr.forEach((n, i) => {
      n.position = { x: Math.round(col * X), y: Math.round(i * Y - h / 2 + (col % 2 ? 40 : 0)) };
    });
  }
}
