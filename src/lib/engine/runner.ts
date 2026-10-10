"use client";
// InvestigationEngine — orchestrates an investigation run as parallel research branches.
// Perception runs in the browser (OCR, CLIP, detection, EXIF, colour); research runs on the
// server through provider abstractions (short, cache-backed requests that fit serverless
// limits). Every step streams events so the UI and evidence board grow live.

import type { Candidate, Clue, ImageAnalysis, ImageRecord, Investigation, InvestigationFocus, InvestigationMode, InvestigationRun, RunStep, TimelineEvent } from "@/lib/types";
import type { ResearchDelta, TextInput } from "./protocol";
import { api, imageUrl, proxied } from "@/lib/client/api";
import { mergeDelta } from "./merge";
import { assess, imageDateHints } from "./reasoning";
import { buildBoard } from "./graph";
import { nowIso, pLimit, uid, yearOf } from "@/lib/util";
import type { AiVisionResult } from "@/lib/types";

export const PHASES = [
  { id: "ingest", label: "INGESTING IMAGE" },
  { id: "extract", label: "EXTRACTING VISUAL CLUES" },
  { id: "ocr", label: "OCR ANALYSIS" },
  { id: "search", label: "VISUAL SEARCH" },
  { id: "candidates", label: "GENERATING CANDIDATES" },
  { id: "matching", label: "MATCHING EVIDENCE" },
  { id: "building", label: "BUILDING CASE" },
  { id: "result", label: "RESULT" },
] as const;
export type PhaseId = (typeof PHASES)[number]["id"];

export type RunEvent =
  | { type: "phase"; phase: PhaseId }
  | { type: "step"; step: RunStep }
  | { type: "state"; inv: Investigation }
  | { type: "clues"; imageId: string; clues: Clue[] }
  | { type: "focus"; imageId: string; box?: { x: number; y: number; w: number; h: number }; label?: string }
  | { type: "compare"; candidateId: string; thumb: string; overall: string }
  | { type: "locate"; name: string; lat: number; lng: number; precision: string; confidence: number; confirmed: boolean }
  | { type: "log"; text: string; level?: "info" | "warn" | "error" };

export interface RunOptions {
  mode: InvestigationMode;
  focus?: InvestigationFocus;
  signal?: AbortSignal;
  onEvent: (e: RunEvent) => void;
  providers?: { ai: boolean; cloudVision: boolean };
}

const MODE_CFG: Record<InvestigationMode, { detect: boolean; ocrPasses: number; maxLookups: number; compareCands: number; compareImgs: number; verify: ("web" | "news" | "videos" | "history")[]; web: boolean; maxQueries: number }> = {
  quick: { detect: false, ocrPasses: 1, maxLookups: 6, compareCands: 2, compareImgs: 2, verify: [], web: false, maxQueries: 14 },
  deep: { detect: true, ocrPasses: 2, maxLookups: 12, compareCands: 4, compareImgs: 6, verify: ["web", "news", "videos"], web: true, maxQueries: 45 },
  visual: { detect: true, ocrPasses: 1, maxLookups: 8, compareCands: 5, compareImgs: 4, verify: [], web: false, maxQueries: 30 },
  location: { detect: false, ocrPasses: 2, maxLookups: 12, compareCands: 3, compareImgs: 3, verify: ["web"], web: true, maxQueries: 35 },
  document: { detect: false, ocrPasses: 2, maxLookups: 14, compareCands: 1, compareImgs: 1, verify: ["web", "history"], web: true, maxQueries: 35 },
  sports: { detect: true, ocrPasses: 2, maxLookups: 12, compareCands: 4, compareImgs: 6, verify: ["web", "news", "videos"], web: true, maxQueries: 40 },
  building: { detect: false, ocrPasses: 2, maxLookups: 12, compareCands: 4, compareImgs: 5, verify: ["web"], web: true, maxQueries: 35 },
  historical: { detect: false, ocrPasses: 2, maxLookups: 12, compareCands: 3, compareImgs: 3, verify: ["web", "history", "news"], web: true, maxQueries: 40 },
  custom: { detect: true, ocrPasses: 2, maxLookups: 12, compareCands: 3, compareImgs: 3, verify: ["web", "news"], web: true, maxQueries: 40 },
};

// in-memory embeddings for the current session (not persisted)
const embeddings = new Map<string, Float32Array>();

class Cancelled extends Error {}

const compactName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Compact text summary of everything the perception phases found, for the AI geolocator. */
function geoClueText(inv: Investigation, sceneHints: string[], ai: AiVisionResult[]) {
  const by = (t: string) => inv.clues.filter((c) => !c.ignored && c.type === t).sort((a, b) => b.weight - a.weight);
  const line = (label: string, vals: string[]) => (vals.length ? `${label}: ${Array.from(new Set(vals)).slice(0, 25).join(" | ")}` : "");
  const exif = inv.images.map((i) => i.analysis?.exif).find((e) => e?.lat !== undefined || e?.takenAt);
  return [
    line("Visible text", [...by("text"), ...by("document")].map((c) => `${c.value}${c.weight < 0.5 ? " (uncertain)" : ""}`)),
    line("Logos/brands", by("logo").map((c) => c.value)),
    line("Flags", by("flag").map((c) => c.value)),
    line("Scene", [...sceneHints, ...ai.map((a) => a.sceneType)]),
    line("Architecture", ai.flatMap((a) => a.architecture)),
    line("Environment", ai.flatMap((a) => a.environment)),
    line("Resolved entities", inv.entities.map((e) => `${e.name} (${e.type})`)),
    line("Other clues", inv.clues.filter((c) => !c.ignored && !["text", "document", "logo", "flag"].includes(c.type)).map((c) => `${c.type}: ${c.value}`)),
    exif?.lat !== undefined ? `Photo GPS metadata: ${exif.lat}, ${exif.lng}` : "",
    exif?.takenAt ? `Photo date metadata: ${exif.takenAt}` : "",
    inv.notes.length ? line("Investigator notes (unverified)", inv.notes.map((n) => n.text)) : "",
    inv.customInstructions ? `Instructions: ${inv.customInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 7500);
}

export async function runInvestigation(start: Investigation, opts: RunOptions): Promise<Investigation> {
  const cfg = MODE_CFG[opts.mode];
  const emit = opts.onEvent;
  let inv: Investigation = structuredClone(start);
  const run: InvestigationRun = { id: uid("run"), mode: opts.mode, startedAt: nowIso(), status: "running", steps: [], budget: { maxQueries: cfg.maxQueries, used: 0 }, focus: opts.focus?.instruction };
  inv.status = "running";
  inv.mode = opts.mode;
  inv.focus = opts.focus;
  inv.runs = [...inv.runs.slice(-19), run];

  const check = () => {
    if (opts.signal?.aborted) throw new Cancelled("Investigation cancelled.");
  };
  const publish = () => emit({ type: "state", inv });
  const step = async <T>(branch: string, label: string, fn: (s: RunStep) => Promise<T>, optional = true): Promise<T | undefined> => {
    check();
    const s: RunStep = { id: uid("st"), branch, label, status: "running", startedAt: nowIso() };
    run.steps.push(s);
    emit({ type: "step", step: { ...s } });
    try {
      const r = await fn(s);
      s.status = s.status === "running" ? "done" : s.status;
      return r;
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      s.status = "error";
      s.detail = e instanceof Error ? e.message : String(e);
      emit({ type: "log", text: `${label}: ${s.detail}`, level: "warn" });
      if (!optional) throw e;
      return undefined;
    } finally {
      s.finishedAt = nowIso();
      emit({ type: "step", step: { ...s } });
    }
  };
  const apply = (d: Partial<ResearchDelta>) => {
    inv = mergeDelta(inv, d);
    run.budget.used += d.queries?.length || 0;
    for (const n of d.notes || []) emit({ type: "log", text: n });
    publish();
  };
  // AI hypotheses that match an existing candidate (same name or within ~1.5 km) strengthen it instead of duplicating it
  const mergeAiCandidates = (d: ResearchDelta) => {
    const fresh: Candidate[] = [];
    for (const c of d.candidates || []) {
      const loc = d.locations?.find((l) => l.id === c.locationId);
      // same place = close together on the map; a shared name alone is not enough (many places are called "Broadway")
      const precision = loc?.kind.startsWith("ai-") ? loc.kind.slice(3) : "exact";
      const sameNameKm = ({ exact: 2, street: 15, neighbourhood: 15, city: 30, region: 150, country: 800 } as Record<string, number>)[precision] ?? 15;
      const twin = inv.candidates.find((x) => {
        const xl = inv.locations.find((l) => l.id === x.locationId);
        const km = loc && xl ? Math.hypot(loc.lat - xl.lat, (loc.lng - xl.lng) * Math.cos((loc.lat * Math.PI) / 180)) * 111 : null;
        const sameName = compactName(x.name) === compactName(c.name) || x.names.some((n) => compactName(n.name) === compactName(c.name));
        if (sameName) {
          const cityClash = c.city && (x.city || x.address) && !compactName(`${x.city || ""} ${x.address || ""}`).includes(compactName(c.city));
          return !cityClash && (km === null || km <= sameNameKm);
        }
        return km !== null && km < 1.5;
      });
      if (twin) {
        twin.signals = { ...twin.signals, ai: Math.max(twin.signals.ai ?? 0, c.signals.ai ?? 0) };
        twin.why = Array.from(new Set([...twin.why, ...c.why.filter((w) => w.startsWith("AI geolocation"))]));
        twin.sourceIds = Array.from(new Set([...twin.sourceIds, ...c.sourceIds]));
      } else {
        // "Broadway, New York City" vs an existing "Broadway" elsewhere: the AI version is a more specific
        // reading of the same visible name, so it inherits that name (and its text evidence) for scoring
        const base = compactName(c.name.split(",")[0]);
        const namesake = inv.candidates.find((x) => base.length >= 4 && (compactName(x.name) === base || x.names.some((n) => compactName(n.name) === base)));
        // keep both apart in the UI: the AI one is labelled with its city
        if (namesake && compactName(c.name) === compactName(namesake.name) && c.city) c.name = `${c.name}, ${c.city}`;
        if (namesake) {
          c.names = [...namesake.names.filter((n) => !c.names.some((m) => compactName(m.name) === compactName(n.name))), ...c.names];
          c.derivedFrom = Array.from(new Set([...c.derivedFrom, ...namesake.derivedFrom.filter((d) => d !== "AI geolocation")]));
        }
        fresh.push(c);
      }
    }
    apply({ ...d, candidates: fresh, locations: (d.locations || []).filter((l) => fresh.some((c) => c.locationId === l.id)) });
  };
  const overBudget = () => run.budget.used >= run.budget.maxQueries;
  const save = async () => {
    try {
      const { investigation } = await api.save(inv);
      inv = { ...inv, updatedAt: investigation.updatedAt };
    } catch (e) {
      emit({ type: "log", text: `Autosave failed: ${e instanceof Error ? e.message : e}`, level: "warn" });
    }
  };

  try {
    if (!inv.images.length) throw new Error("Add at least one image to investigate.");
    // reset derived state (keeps images, notes, chat, user boards, regions)
    inv = { ...inv, dossiers: [], clues: inv.clues.filter((c) => c.origin === "user"), entities: [], candidates: [], locations: inv.locations.filter((l) => l.userSelected), evidence: inv.evidence.filter((e) => e.kind === "user"), timeline: inv.timeline.filter((t) => t.userProvided), contradictions: [], conclusion: undefined };
    const ignored = new Set(start.clues.filter((c) => c.ignored).map((c) => c.value.toLowerCase()));

    // ---------------- PHASE 1: ingest ----------------
    emit({ type: "phase", phase: "ingest" });
    const { loadImage, toCanvas } = await import("@/lib/vision/image");
    const images = opts.focus?.imageId ? inv.images.filter((i) => i.id === opts.focus!.imageId) : inv.images;
    const canvases = new Map<string, HTMLCanvasElement>();
    await step("ingest", `Loading ${images.length} image${images.length > 1 ? "s" : ""}`, async (s) => {
      for (const im of images) {
        const el = await loadImage(imageUrl(im.key));
        const region = opts.focus?.regionId ? inv.regions.find((r) => r.id === opts.focus!.regionId) : undefined;
        canvases.set(im.id, toCanvas(el, 1600, region?.imageId === im.id ? region.box : undefined));
      }
      s.detail = images.map((i) => `${i.name} (${i.width}×${i.height})`).join(", ");
    }, false);
    publish();

    // ---------------- PHASE 2: visual clues ----------------
    emit({ type: "phase", phase: "extract" });
    const { colorStats } = await import("@/lib/vision/features");
    const clip = await import("@/lib/vision/clip");
    const sceneHints = new Set<string>();
    const aiResults = new Map<string, AiVisionResult>();
    const cloudResults = new Map<string, { logos: { name: string; score: number; box?: { x: number; y: number; w: number; h: number } }[]; landmarks: { name: string; score: number; lat?: number; lng?: number }[]; text: { text: string; box?: { x: number; y: number; w: number; h: number } }[]; labels: { name: string; score: number }[] }>();

    // Server-side multimodal analysis runs in parallel with in-browser perception.
    const serverAnalysis = opts.providers && (opts.providers.ai || opts.providers.cloudVision)
      ? Promise.all(
          images.map((im) =>
            step("ai-vision", `Multimodal analysis · ${im.name}`, async (s) => {
              const region = opts.focus?.regionId ? inv.regions.find((r) => r.id === opts.focus!.regionId && r.imageId === im.id) : undefined;
              const r = await api.post<{ ai: { status: string; result?: AiVisionResult; error?: string }; cloud: { status: string; error?: string; logos: never[]; landmarks: never[]; text: never[]; labels: never[] } | null }>(
                "/api/analyze",
                { imageKey: im.key, width: im.width, height: im.height, mode: opts.mode, focus: opts.focus?.instruction, instructions: inv.customInstructions, region: region?.box, providers: [...(opts.providers!.ai ? ["ai"] : []), ...(opts.providers!.cloudVision ? ["cloud-vision"] : [])] },
                opts.signal,
              );
              if (r.ai.status === "ok" && r.ai.result) aiResults.set(im.id, r.ai.result);
              if (r.cloud?.status === "ok") cloudResults.set(im.id, r.cloud);
              s.detail = [r.ai.status === "ok" ? `AI: ${r.ai.result!.sceneType}` : `AI ${r.ai.status}${r.ai.error ? `: ${r.ai.error}` : ""}`, r.cloud ? `Cloud Vision ${r.cloud.status}` : ""].filter(Boolean).join(" · ");
              if (r.ai.status === "error") s.status = "error";
            }),
          ),
        )
      : Promise.resolve([]);

    for (const im of images) {
      const c = canvases.get(im.id)!;
      const analysis: ImageAnalysis = { analyzedAt: nowIso(), engines: [], scene: [], objects: [], ocr: [], colors: [], brightness: 0, skyShare: 0, indoorLikely: null, exif: im.analysis?.exif, warnings: [] };
      const clues: Clue[] = [];
      emit({ type: "focus", imageId: im.id });
      const cs = colorStats(c);
      Object.assign(analysis, cs);
      analysis.engines.push("color-stats");
      if (analysis.exif?.lat !== undefined) {
        clues.push({ id: uid("clue"), imageId: im.id, type: "exif", label: "GPS", value: `${analysis.exif.lat!.toFixed(5)}, ${analysis.exif.lng!.toFixed(5)}`, weight: 0.95, origin: "exif", engine: "exifr" });
      }
      if (analysis.exif?.takenAt) clues.push({ id: uid("clue"), imageId: im.id, type: "date", label: "Photo date (metadata)", value: analysis.exif.takenAt.slice(0, 10), weight: 0.8, origin: "exif", engine: "exifr" });
      await step("vision", `Scene understanding (CLIP) · ${im.name}`, async (s) => {
        const emb = await clip.imageEmbedding(c);
        embeddings.set(im.id, emb);
        const sc = await clip.classifyScene(emb);
        analysis.scene = sc.scenes;
        analysis.engines.push("clip-vit-b32");
        sc.hints.forEach((h) => sceneHints.add(h));
        const top = sc.scenes[0];
        clues.push({ id: uid("clue"), imageId: im.id, type: "scene", label: "Scene", value: top.label, weight: Math.min(0.9, top.score + 0.2), origin: "vision-model", engine: "CLIP zero-shot" });
        if (top.group === "sports venue") clues.push({ id: uid("clue"), imageId: im.id, type: "sport", label: "Sport", value: sc.hints.filter((h) => !["arena", "stadium"].includes(h)).join(", ") || top.label, weight: top.score, origin: "vision-model", engine: "CLIP zero-shot" });
        const indoorScore = sc.environment.find((e) => e.label.startsWith("indoors"))?.score ?? 0;
        analysis.indoorLikely = indoorScore > 0.4 ? true : analysis.skyShare > 0.25 ? false : null;
        for (const e of sc.environment.slice(0, 2)) if (e.score > 0.25) clues.push({ id: uid("clue"), imageId: im.id, type: "environment", label: "Environment", value: e.label, weight: e.score * 0.6, origin: "vision-model", engine: "CLIP zero-shot" });
        if (["building", "business", "landmark", "street", "sports venue"].includes(top.group) && sc.styles[0].score > 0.3)
          clues.push({ id: uid("clue"), imageId: im.id, type: "architecture", label: "Architectural style (probabilistic)", value: sc.styles[0].label, weight: sc.styles[0].score * 0.6, origin: "vision-model", engine: "CLIP zero-shot" });
        s.detail = `${top.label}${sc.hints.length ? ` · hints: ${sc.hints.join(", ")}` : ""}`;
      });
      let caption = "";
      if (opts.mode !== "quick") {
        await step("vision", `Image description (Florence-2) · ${im.name}`, async (s) => {
          const { florenceCaption } = await import("@/lib/vision/florence");
          const cap = await florenceCaption(c, (m) => ((s.detail = m), emit({ type: "step", step: { ...s } })));
          if (cap) {
            caption = cap;
            clues.push({ id: uid("clue"), imageId: im.id, type: "scene", label: "Description", value: cap, weight: 0.4, origin: "vision-model", engine: "florence-2 caption" });
            if (/\bflags?\b/i.test(cap)) s.detail = `${cap} (flag mentioned)`;
            else s.detail = cap;
          }
        });
      }
      const sport = ["basketball", "football", "baseball", "hockey", "soccer"].find((h) => sceneHints.has(h));
      const sportScene = (analysis.scene[0]?.group === "sports venue" && analysis.scene[0].score >= 0.4) && (!caption || /\b(court|arena|stadium|game|match|basketball|football|soccer|baseball|hockey|players?|field|rink|pitch|team)\b/i.test(caption));
      if (sport && sportScene && embeddings.has(im.id) && opts.mode !== "quick") {
        await step("logo", `Logo recognition (CLIP zero-shot vs ${sport} teams from Wikidata)`, async (s) => {
          const r = await api.get<{ leagues: { league: string; teams: { id: string; label: string }[] }[] }>(`/api/knowledge/teams?sport=${sport}`);
          const teams = Array.from(new Set(r.leagues.flatMap((l) => l.teams.map((t) => t.label)))).slice(0, 120);
          if (!teams.length) {
            s.status = "skipped";
            s.detail = "No team list available";
            return;
          }
          const ranked = await clip.recognizeLogos(c, teams, sport);
          const [a, b] = ranked;
          if (a && a.p >= 0.5 && (!b || a.p >= b.p * 2.5)) {
            clues.push({ id: uid("clue"), imageId: im.id, type: "logo", label: "Logo (visual recognition, probabilistic)", value: a.name, weight: Math.min(0.8, a.p), origin: "vision-model", engine: "CLIP zero-shot · Wikidata team list" });
            for (const o of ranked.slice(1, 3)) if (o.p >= 0.12) clues.push({ id: uid("clue"), imageId: im.id, type: "logo", label: "Possible second team branding (weak)", value: o.name, weight: Math.min(0.4, o.p), origin: "vision-model", engine: "CLIP zero-shot · Wikidata team list" });
            s.detail = `${a.name} (${a.p >= 0.6 ? "strong" : "moderate"} visual match)${ranked[1] ? ` · next: ${ranked[1].name}` : ""} · ${teams.length} teams compared`;
          } else {
            s.detail = `No team logo recognised confidently among ${teams.length} teams (closest: ${ranked.slice(0, 3).map((x) => `${x.name} ${x.p.toFixed(2)}`).join(", ")})`;
          }
        });
      }
      if (opts.mode !== "quick" && embeddings.has(im.id)) {
        const rec = await import("@/lib/vision/recognize");
        await step("flags", `Flag recognition (${rec.COUNTRIES.length} national flags) · ${im.name}`, async (s) => {
          const flags = await rec.recognizeFlags(c);
          for (const f of flags)
            clues.push({ id: uid("clue"), imageId: im.id, type: "flag", label: `Flag (visual recognition${f.tiles > 1 ? `, seen in ${f.tiles} regions` : ""})`, value: f.name, weight: Math.min(0.85, f.p + (f.tiles - 1) * 0.05), box: f.box.w < 1 ? f.box : undefined, origin: "vision-model", engine: "CLIP zero-shot · flags" });
          s.detail = flags.length ? flags.map((f) => `${f.name} (${f.p >= 0.6 ? "strong" : "moderate"})`).join(", ") : "No national flag recognised confidently";
        });
        await step("logo", `Brand & sponsor logo recognition (${rec.BRANDS.length} brands) · ${im.name}`, async (s) => {
          const brands = await rec.recognizeBrands(c);
          for (const b of brands)
            clues.push({ id: uid("clue"), imageId: im.id, type: "logo", label: "Brand / sponsor logo (visual recognition, probabilistic)", value: b.name, weight: Math.min(0.75, b.p), box: b.box.w < 1 ? b.box : undefined, origin: "vision-model", engine: "CLIP zero-shot · brands" });
          s.detail = brands.length ? brands.map((b) => b.name).join(", ") : "No brand logo recognised confidently";
        });
      }
      if (cfg.detect) {
        await step("vision", `Object detection · ${im.name}`, async (s) => {
          const objs = await clip.detectObjects(c);
          analysis.objects = objs;
          analysis.engines.push("detr-resnet-50");
          const counts = new Map<string, number>();
          for (const o of objs) counts.set(o.label, (counts.get(o.label) || 0) + 1);
          for (const [label, n] of counts) {
            const best = objs.filter((o) => o.label === label).sort((a, b) => b.score - a.score)[0];
            if (label === "person") continue; // people are not investigated
            clues.push({ id: uid("clue"), imageId: im.id, type: "object", label: "Object", value: n > 1 ? `${label} ×${n}` : label, weight: best.score * 0.5, box: best.box, origin: "detector", engine: "DETR" });
          }
          const people = counts.get("person") || 0;
          s.detail = `${objs.length} objects${people ? ` (${people} people — not analysed for identity)` : ""}`;
        });
      }
      im.analysis = { ...analysis };
      inv.clues.push(...clues);
      emit({ type: "clues", imageId: im.id, clues });
      publish();
    }

    // ---------------- PHASE 3: OCR ----------------
    emit({ type: "phase", phase: "ocr" });
    const { runOcr } = await import("@/lib/vision/ocr");
    for (const im of images) {
      const c = canvases.get(im.id)!;
      await step("ocr", `OCR · ${im.name}`, async (s) => {
        const region = opts.focus?.regionId ? inv.regions.find((r) => r.id === opts.focus!.regionId && r.imageId === im.id) : undefined;
        const isDoc = opts.mode === "document" || im.analysis?.scene?.[0]?.group === "document";
        const source = region ? "region" : im.enhancedFrom ? "enhanced" : "original";
        let lines: import("@/lib/types").OcrLine[] = [];
        const engines: string[] = [];
        // Documents: Tesseract (layout-aware). Photos: Florence-2 scene-text OCR, Tesseract as fallback.
        if (isDoc) {
          lines = await runOcr(c, { source, region: region?.box, passes: cfg.ocrPasses });
          engines.push("tesseract");
        }
        if (!isDoc || opts.mode !== "quick") {
          try {
            const { florenceOcr } = await import("@/lib/vision/florence");
            const fl = await florenceOcr(c, { tiles: !region && opts.mode !== "quick", region: region?.box, onProgress: (m) => ((s.detail = m), emit({ type: "step", step: { ...s } })) });
            for (const l of fl) if (!lines.some((x) => x.text.toLowerCase() === l.text.toLowerCase())) lines.push({ ...l, source });
            engines.push("florence-2");
          } catch (e) {
            emit({ type: "log", text: `Scene-text OCR model unavailable (${e instanceof Error ? e.message : e}); using Tesseract.`, level: "warn" });
            if (!isDoc) {
              lines = await runOcr(c, { source, region: region?.box, passes: cfg.ocrPasses });
              engines.push("tesseract");
            }
          }
        }
        lines.sort((a, b) => b.confidence - a.confidence);
        im.analysis!.ocr = lines;
        im.analysis!.engines.push(...engines);
        const clues: Clue[] = lines.map((l) => ({ id: uid("clue"), imageId: im.id, type: "text", label: l.uncertain ? "Text (uncertain)" : "Text", value: l.text, weight: l.confidence / 100, box: l.box, origin: "ocr", engine: l.engine, regionId: region?.id }));
        for (const l of lines) {
          const y = yearOf(l.text);
          if (y && y >= 1850 && y <= new Date().getFullYear() && /\b(1[89]\d\d|20\d\d)\b/.test(l.text) && !/^\d+$/.test(l.text.replace(/\s/g, "")))
            clues.push({ id: uid("clue"), imageId: im.id, type: "date", label: "Year in visible text", value: String(y), weight: 0.35, box: l.box, origin: "ocr", engine: l.engine });
        }
        inv.clues.push(...clues);
        emit({ type: "clues", imageId: im.id, clues });
        for (const l of lines.slice(0, 4)) emit({ type: "focus", imageId: im.id, box: l.box, label: l.text });
        s.detail = `${engines.join(" + ")}: ` + (lines.length ? `${lines.length} text lines · e.g. “${lines.slice(0, 4).map((l) => l.text).join("”, “")}”` : "no legible text found");
      });
      publish();
    }

    await serverAnalysis;
    for (const im of images) {
      const ai = aiResults.get(im.id);
      const cloud = cloudResults.get(im.id);
      const clues: Clue[] = [];
      if (ai) {
        im.analysis!.ai = ai;
        im.analysis!.engines.push(ai.model);
        // the multimodal model's description is far more reliable than the small local captioner's
        if (ai.summary) {
          inv = { ...inv, clues: inv.clues.filter((c) => !(c.imageId === im.id && c.engine === "florence-2 caption")) };
          clues.push({ id: uid("clue"), imageId: im.id, type: "scene", label: "Description (AI)", value: ai.summary, weight: 0.5, origin: "ai", engine: ai.model });
        }
        for (const t of ai.text) clues.push({ id: uid("clue"), imageId: im.id, type: "text", label: `Text (AI reading, ${t.confidence})`, value: t.text, weight: t.confidence === "high" ? 0.85 : t.confidence === "medium" ? 0.6 : 0.35, origin: "ai", engine: ai.model });
        // two independent readers agreeing on a text makes the OCR reading trustworthy
        const aiTexts = ai.text.map((t) => compactName(t.text)).filter((t) => t.length >= 3);
        inv = {
          ...inv,
          clues: inv.clues.map((c) => {
            if (c.imageId !== im.id || c.origin !== "ocr" || c.type !== "text" || c.weight >= 0.8) return c;
            const v = compactName(c.value);
            const agreed = v.length >= 3 && aiTexts.some((a) => a.includes(v) || (v.length >= 5 && v.includes(a)));
            return agreed ? { ...c, weight: 0.82, label: "Text (confirmed by AI reading)" } : c;
          }),
        };
        for (const l of ai.logos) clues.push({ id: uid("clue"), imageId: im.id, type: "logo", label: `Logo · ${l.category}`, value: l.name, weight: l.confidence === "high" ? 0.85 : l.confidence === "medium" ? 0.6 : 0.35, origin: "ai", engine: ai.model });
        for (const a of ai.architecture.slice(0, 4)) clues.push({ id: uid("clue"), imageId: im.id, type: "architecture", label: "Architecture (AI)", value: a, weight: 0.4, origin: "ai", engine: ai.model });
        for (const e of ai.environment.slice(0, 4)) clues.push({ id: uid("clue"), imageId: im.id, type: "environment", label: "Environment (AI)", value: e, weight: 0.3, origin: "ai", engine: ai.model });
        for (const f of ai.flags || []) clues.push({ id: uid("clue"), imageId: im.id, type: "flag", label: `Flag (AI, ${f.confidence})`, value: f.country, weight: f.confidence === "high" ? 0.85 : f.confidence === "medium" ? 0.6 : 0.35, origin: "ai", engine: ai.model });
        if (ai.sport) clues.push({ id: uid("clue"), imageId: im.id, type: "sport", label: "Sport (AI)", value: `${ai.sport.sport}: ${ai.sport.features.slice(0, 3).join(", ")}`, weight: 0.6, origin: "ai", engine: ai.model });
        if (ai.document?.publication) clues.push({ id: uid("clue"), imageId: im.id, type: "document", label: "Publication (AI)", value: ai.document.publication, weight: 0.7, origin: "ai", engine: ai.model });
        if (ai.document?.date) clues.push({ id: uid("clue"), imageId: im.id, type: "date", label: "Document date (AI)", value: ai.document.date, weight: 0.5, origin: "ai", engine: ai.model });
        if (/basketball/i.test(ai.sceneType + (ai.sport?.sport || ""))) sceneHints.add("basketball");
      }
      if (cloud) {
        im.analysis!.engines.push("google-cloud-vision");
        for (const l of cloud.logos) clues.push({ id: uid("clue"), imageId: im.id, type: "logo", label: "Logo (Cloud Vision)", value: l.name, weight: l.score, box: l.box, origin: "detector", engine: "google-cloud-vision" });
        for (const l of cloud.landmarks) clues.push({ id: uid("clue"), imageId: im.id, type: "architecture", label: "Landmark (Cloud Vision)", value: l.name, weight: l.score, origin: "detector", engine: "google-cloud-vision" });
      }
      if (clues.length) {
        inv.clues.push(...clues);
        emit({ type: "clues", imageId: im.id, clues });
      }
    }
    // apply user "ignore" choices from before the rerun
    for (const c of inv.clues) if (ignored.has(c.value.toLowerCase())) c.ignored = true;
    publish();
    void save();

    // ---------------- PHASE 4: search ----------------
    emit({ type: "phase", phase: "search" });
    const focusTypes = opts.focus?.clueTypes;
    const usable = inv.clues.filter((c) => !c.ignored && (!focusTypes?.length || focusTypes.includes(c.type)));
    const texts: TextInput[] = usable
      .filter((c) => ["text", "document"].includes(c.type) && (c.origin !== "ocr" || c.weight >= 0.5))
      .map((c) => ({ text: c.value, confidence: Math.round(c.weight * 100), origin: c.origin === "ai" ? "ai" : "ocr", clueId: c.id }));
    // join spatially adjacent text (e.g. "StateFarm" stacked over "ARENA") into composite phrases
    const boxed = usable.filter((c) => c.type === "text" && c.box && c.value.length <= 24);
    const composites: TextInput[] = [];
    for (const a of boxed)
      for (const b of boxed) {
        if (a === b || a.imageId !== b.imageId || composites.length >= 12) continue;
        const A = a.box!;
        const B = b.box!;
        const hOverlap = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const below = B.y >= A.y + A.h * 0.5 && B.y - (A.y + A.h) < Math.max(A.h, B.h) * 1.6 && hOverlap > -Math.max(A.h, B.h);
        const rightOf = Math.abs(B.y - A.y) < Math.max(A.h, B.h) * 0.6 && B.x > A.x && B.x - (A.x + A.w) < Math.max(A.h, B.h) * 1.5;
        if (below || rightOf) composites.push({ text: `${a.value} ${b.value}`, confidence: Math.round(Math.min(a.weight, b.weight) * 90), origin: "ocr", clueId: a.id });
      }
    texts.push(...composites);
    const logos = usable.filter((c) => c.type === "logo" || c.type === "flag").map((c) => ({ name: c.value, confidence: c.weight, clueId: c.id }));
    const landmarks = [...cloudResults.values()].flatMap((c) => c.landmarks);
    const aiEntities = [...aiResults.values()].flatMap((a) => a.entities);
    await step("entities", "Entity extraction & resolution (Wikipedia/Wikidata)", async (s) => {
      const d = await api.post<ResearchDelta>("/api/entities", { texts: texts.slice(0, 150), sceneHints: [...sceneHints], logos, landmarks, aiEntities: aiEntities.slice(0, 40), mode: opts.mode, maxLookups: cfg.maxLookups }, opts.signal);
      apply(d);
      s.detail = d.entities?.length ? d.entities.map((e) => `${e.name} (${e.type.replace("_", " ")})`).slice(0, 6).join(", ") : "No entities resolved";
    });

    const branchQueries: { kind: "web" | "news" | "history"; query: string; branch: string }[] = [];
    const topEnts = inv.entities.filter((e) => e.wikidataId).slice(0, 3);
    if (cfg.web) {
      for (const e of topEnts.slice(0, 2)) {
        branchQueries.push({ kind: "web", branch: e.type === "sports_team" ? "sports" : "web", query: e.type === "sports_team" ? `${e.name} home arena history` : `${e.name} ${e.type === "publication" ? "newspaper history" : "location"}` });
      }
      for (const q of [...aiResults.values()].flatMap((a) => a.suggestedQueries).slice(0, opts.mode === "deep" ? 3 : 1)) branchQueries.push({ kind: "web", branch: "ai-suggested", query: q });
      if (opts.mode === "document" || opts.mode === "historical") {
        const doc = usable.find((c) => c.type === "document")?.value || usable.filter((c) => c.type === "text").sort((a, b) => b.weight - a.weight)[0]?.value;
        if (doc) branchQueries.push({ kind: "history", branch: "historical", query: doc });
      }
    }
    if (!topEnts.length && cfg.web) {
      const strong = usable.filter((c) => c.type === "text" && c.weight >= 0.6).sort((a, b) => b.weight - a.weight)[0];
      if (strong) branchQueries.push({ kind: "web", branch: "web", query: `"${strong.value}" ${[...sceneHints][0] || ""}`.trim() });
    }
    // subject dossiers: who/what is in the image (an airline, a company, a meme template…), researched in depth
    const subjects: { name: string; kind: string; wikidataId?: string; why: string }[] = [];
    const addSubject = (x: { name: string; kind: string; wikidataId?: string; why: string }) => {
      if (x.name.trim().length < 2 || subjects.some((y) => compactName(y.name) === compactName(x.name) || (x.wikidataId && y.wikidataId === x.wikidataId))) return;
      subjects.push(x);
    };
    for (const a of aiResults.values()) for (const sub of a.subjects || []) addSubject({ name: sub.name, kind: sub.kind, why: sub.why ? `AI: ${sub.why}` : "Main subject identified by AI vision" });
    const ENT_KIND: Partial<Record<string, string>> = { organization: "organization", sports_team: "sports team", brand: "brand", product: "product", venue: "landmark", building: "landmark", event: "event" };
    for (const e of inv.entities.filter((x) => x.wikidataId && ENT_KIND[x.type] && x.matchQuality !== "weak").slice(0, 3))
      addSubject({ name: e.name, kind: ENT_KIND[e.type]!, wikidataId: e.wikidataId, why: e.detectedBecause[0] || "Resolved from text or logos in the image" });
    const dossierJobs = subjects.slice(0, opts.mode === "quick" ? 2 : 5).map((sub) =>
      step("dossier", `Researching ${sub.kind === "meme" ? "meme" : sub.kind}: ${sub.name}`, async (s) => {
        const body = { name: sub.name, kind: sub.kind, wikidataId: sub.wikidataId, foundBecause: sub.why };
        type DR = ResearchDelta & { dossier: import("@/lib/types").Dossier | null };
        // one retry: very large public records occasionally time out on the first attempt
        const d = await api.post<DR>("/api/dossier", body, opts.signal).catch(() => api.post<DR>("/api/dossier", body, opts.signal));
        apply(d);
        const fin = d.dossier?.facts.filter((f) => f.group === "financials").map((f) => `${f.label} ${f.value}`) || [];
        s.detail = d.dossier ? `${d.dossier.facts.length} facts${fin.length ? ` · ${fin.slice(0, 2).join(" · ")}` : ""} · ${d.dossier.newsIds.length} articles` : "No public profile found";
        if (!d.dossier) s.status = "skipped";
      }),
    );
    await Promise.all([
      ...dossierJobs,
      ...branchQueries.map((bq) =>
        overBudget()
          ? Promise.resolve()
          : step(bq.branch, `${bq.kind === "history" ? "Historical records" : bq.kind === "news" ? "News" : "Web"} search: “${bq.query}”`, async (s) => {
              const d = await api.post<ResearchDelta>("/api/search", bq, opts.signal);
              apply(d);
              s.detail = d.queries.map((q) => `${q.provider}: ${q.status}${q.resultCount ? ` (${q.resultCount})` : ""}`).join(" · ");
            }),
      ),
    ]);

    // ---------------- PHASE 5: candidates ----------------
    emit({ type: "phase", phase: "candidates" });
    const exif = images.map((i) => i.analysis?.exif).find((e) => e?.lat !== undefined || e?.takenAt);
    const candReq = {
      entities: inv.entities.map((e) => ({ id: e.id, name: e.name, type: e.type, wikidataId: e.wikidataId, matchQuality: e.matchQuality })),
      texts: texts.slice(0, 150),
      sceneHints: [...sceneHints],
      exif: exif ? { lat: exif.lat, lng: exif.lng, takenAt: exif.takenAt } : undefined,
      landmarks,
      mode: opts.mode,
      maxCandidates: opts.mode === "quick" ? 6 : 10,
    };
    await Promise.all([
      step("knowledge", "Knowledge graph: related venues & places (Wikidata)", async (s) => {
        const d = await api.post<ResearchDelta>("/api/candidates", candReq, opts.signal);
        apply(d);
        s.detail = `${d.candidates?.length || 0} candidates from the knowledge graph`;
      }),
      step("maps", "Map search: GPS, landmarks, named places", async (s) => {
        const d = await api.post<ResearchDelta>("/api/candidates/places", candReq, opts.signal);
        apply(d);
        s.detail = `${d.candidates?.length || 0} map candidates · ${d.queries.length} map queries`;
      }),
      opts.providers?.ai && opts.mode !== "document"
        ? step("ai-geolocation", "AI geolocation: reading every clue to pin the location", async (s) => {
            const r = await api.post<{ status: string; error?: string; model: string; overall: string; osmQuery?: { area: string; anchor: { tags?: Record<string, string>; name?: string; label: string }; near: { tags?: Record<string, string>; name?: string; label: string }[]; radiusM: number } | null; locations: { name: string; address: string | null; city: string | null; region: string | null; country: string | null; lat: number | null; lng: number | null; precision: string; confidence: number; reasoning: string; keyClues: string[]; searchQuery: string }[] }>(
              "/api/geolocate",
              { imageKeys: images.slice(0, 3).map((i) => i.key), clues: geoClueText(inv, [...sceneHints], [...aiResults.values()]) },
              opts.signal,
            );
            if (r.status !== "ok") {
              s.status = r.status === "not_configured" ? "skipped" : "error";
              s.detail = r.error;
              return;
            }
            if (r.overall) emit({ type: "log", text: `AI geolocation: ${r.overall}` });
            let confirmed = 0;
            await Promise.all(
              r.locations.slice(0, opts.mode === "quick" ? 2 : 4).map(async (g, rank) => {
                const d = await api.post<ResearchDelta>("/api/geolocate/verify", { ...g, model: r.model, rank }, opts.signal);
                mergeAiCandidates(d);
                const loc = d.locations?.[0];
                const ok = !d.candidates?.[0]?.against.length;
                if (ok) confirmed++;
                if (loc) emit({ type: "locate", name: g.name, lat: loc.lat, lng: loc.lng, precision: g.precision, confidence: g.confidence, confirmed: ok });
              }),
            );
            s.detail = r.locations.length ? `${r.locations.length} hypotheses · ${confirmed} confirmed on the map · top: ${r.locations[0].name}` : "No location hypotheses";
            // features seen together in the image → every place on the map where they occur together
            const oq = r.osmQuery;
            if (oq && opts.mode !== "quick") {
              const label = [oq.anchor.label, ...oq.near.map((n) => n.label)].join(" + ");
              await step("clue-combination", `Map search for clue combination: ${label} in ${oq.area}`, async (s2) => {
                const p = await api.post<{ plan: { ql: string; label: string; radiusM: number; area: string; anchorLabel: string } | null; note?: string; queries: ResearchDelta["queries"] }>("/api/geolocate/osm", { op: "plan", ...oq }, opts.signal);
                apply({ queries: p.queries, results: [], sources: [] });
                if (!p.plan) {
                  s2.status = "skipped";
                  s2.detail = p.note;
                  return;
                }
                s2.detail = "Querying OpenStreetMap from your browser (can take up to a minute when the map servers are busy)…";
                emit({ type: "step", step: { ...s2 } });
                const { overpassQuery } = await import("@/lib/client/overpass");
                const res = await overpassQuery<{ elements: unknown[] }>(p.plan.ql, 70000, opts.signal);
                const { ql: _ql, ...meta } = p.plan;
                void _ql;
                const d = await api.post<ResearchDelta & { matches: number }>("/api/geolocate/osm", { op: "results", ...meta, elements: res.elements.slice(0, 60) }, opts.signal);
                mergeAiCandidates(d);
                for (const loc of (d.locations || []).slice(0, 3)) emit({ type: "locate", name: loc.name, lat: loc.lat, lng: loc.lng, precision: "street", confidence: d.matches === 1 ? 0.75 : 0.4, confirmed: true });
                s2.detail = d.matches ? `${d.matches} place${d.matches > 1 ? "s" : ""} in ${oq.area} where ${label} occur together` : "No place in the area has this combination";
              });
            }
          })
        : Promise.resolve(),
    ]);
    // photo-date timeline event
    for (const dh of imageDateHints(inv)) {
      if (dh.origin === "ocr") continue;
      const t: TimelineEvent = { id: uid("t"), date: String(dh.year), year: dh.year, label: dh.origin === "exif" ? "Photo taken (metadata)" : "Photo date (your note — unverified)", kind: "photo", sourceIds: [], userProvided: dh.origin === "user" };
      if (!inv.timeline.some((x) => x.kind === "photo" && x.year === t.year)) inv.timeline.push(t);
    }
    inv = assess(inv);
    publish();
    void save();

    // ---------------- PHASE 6: visual matching ----------------
    emit({ type: "phase", phase: "matching" });
    const primary = images[0];
    const primaryEmb = embeddings.get(primary.id);
    const toCompare = inv.candidates.filter((c) => c.status !== "rejected").slice(0, cfg.compareCands);
    const { compareCanvases } = await import("@/lib/vision/compare");
    await pLimit(toCompare, 2, async (cand) => {
      await step("visual-search", `Reference photos: ${cand.name}`, async (s) => {
        const r = await api.post<ResearchDelta & { images: { candidateName: string; title: string; url: string; thumb: string; license?: string; sourceId: string }[] }>(
          "/api/candidate-images",
          {
            name: cand.name,
            aliases: cand.names.map((n) => n.name).slice(0, 8),
            city: cand.city,
            category: cand.commonsCategory,
            sceneHint: [...sceneHints].find((h) => ["basketball", "arena", "stadium", "hotel", "restaurant", "university"].includes(h)),
            // with coordinates, also fetch photos actually taken at the spot (street level for outdoor scenes)
            ...(() => {
              const l = inv.locations.find((x) => x.id === cand.locationId);
              return l ? { lat: l.lat, lng: l.lng, outdoor: primary.analysis?.indoorLikely !== true } : {};
            })(),
          },
          opts.signal,
        );
        apply(r);
        const target = inv.candidates.find((c) => c.id === cand.id);
        if (!target) return;
        for (const im of r.images) if (!target.images.some((x) => x.url === im.url)) target.images.push({ id: uid("cimg"), url: im.url, thumb: im.thumb, title: im.title, sourceId: im.sourceId, license: im.license });
        s.detail = `${r.images.length} reference photos`;
      });
      const snapshot = inv.candidates.find((c) => c.id === cand.id);
      if (!snapshot) return;
      await step("matching", `Visual comparison: ${cand.name}`, async (s) => {
        const pending = snapshot.images.filter((i) => !i.comparison).slice(0, cfg.compareImgs);
        let done = 0;
        for (const ref of pending) {
          check();
          try {
            const el = await loadImage(proxied(ref.thumb));
            const rc = toCanvas(el, 640);
            const remb = primaryEmb ? await clip.imageEmbedding(rc) : undefined;
            const comparison = compareCanvases(canvases.get(primary.id)!, rc, primaryEmb, remb);
            // re-resolve against the latest state (other branches may have merged in the meantime)
            const live = inv.candidates.find((c) => c.id === cand.id)?.images.find((i) => i.id === ref.id);
            if (live) live.comparison = comparison;
            emit({ type: "compare", candidateId: cand.id, thumb: proxied(ref.thumb), overall: comparison.overall });
            done++;
          } catch (e) {
            emit({ type: "log", text: `Could not compare ${ref.title}: ${e instanceof Error ? e.message : e}`, level: "warn" });
          }
        }
        const liveImgs = inv.candidates.find((c) => c.id === cand.id)?.images || [];
        s.detail = done ? `${done} photos compared · best: ${["strong", "moderate", "weak", "none"].find((l) => liveImgs.some((i) => i.comparison?.overall === l))}` : "No reference photos could be compared";
        if (!done) s.status = "skipped";
      });
      publish();
    });
    inv = assess(inv);
    publish();

    // AI feature-level comparison for the leading candidate (if configured)
    const leadForAi = inv.candidates.find((c) => c.status === "leading");
    if (opts.providers?.ai && leadForAi && opts.mode !== "quick") {
      const best = [...leadForAi.images].filter((i) => i.comparison).sort((a, b) => (b.comparison!.embedding ?? 0) - (a.comparison!.embedding ?? 0))[0];
      if (best) {
        await step("matching", `AI feature comparison: ${leadForAi.name}`, async (s) => {
          const r = await api.post<{ status: string; matches?: { feature: string; strength: string }[]; differences?: string[]; verdict?: string; note?: string; error?: string }>(
            "/api/compare",
            { imageKey: primary.key, referenceUrl: best.thumb.startsWith("http") ? best.thumb : best.url, context: `${leadForAi.name}${leadForAi.city ? `, ${leadForAi.city}` : ""}` },
            opts.signal,
          );
          if (r.status !== "ok") {
            s.status = r.status === "not_configured" ? "skipped" : "error";
            s.detail = r.error;
            return;
          }
          const c = inv.candidates.find((x) => x.id === leadForAi.id)!;
          const img = c.images.find((i) => i.id === best.id)!;
          img.comparison = { ...img.comparison!, notes: [...img.comparison!.notes, ...(r.matches || []).map((m) => `AI: ${m.feature} (${m.strength})`), ...(r.differences || []).slice(0, 3).map((d) => `AI difference: ${d}`)] };
          s.detail = `${r.verdict}: ${(r.matches || []).length} matching features, ${(r.differences || []).length} differences`;
        });
      }
    }

    // ---------------- PHASE 7: building the case (falsification) ----------------
    emit({ type: "phase", phase: "building" });
    const leaders = inv.candidates.filter((c) => c.status !== "rejected").slice(0, 2);
    if (leaders.length && cfg.verify.length && !overBudget()) {
      await step("falsification", "Searching for evidence that would disprove the leading candidates", async (s) => {
        const team = inv.entities.find((e) => e.type === "sports_team");
        const yh = imageDateHints(inv).find((d) => d.origin !== "ocr")?.year;
        const d = await api.post<ResearchDelta>(
          "/api/verify",
          { candidates: leaders.map((c) => ({ id: c.id, name: c.name, city: c.city, kind: c.kind, activeFrom: c.activeFrom, activeTo: c.activeTo, teamName: team?.name })), yearHint: yh, mode: opts.mode, kinds: cfg.verify },
          opts.signal,
        );
        apply(d);
        const nc = d.queries.filter((q) => q.status === "not_configured").length;
        s.detail = `${d.queries.length} disconfirmation queries · ${d.results.length} results${nc ? ` · ${nc} need provider keys` : ""}`;
      });
    }
    inv = assess(inv);
    inv.boards = [buildBoard(inv, inv.boards[0]), ...inv.boards.slice(1)];
    publish();

    // ---------------- PHASE 8: result ----------------
    emit({ type: "phase", phase: "result" });
    if (opts.providers?.ai && inv.conclusion) {
      await save();
      await step("explain", "AI explanation from collected evidence", async (s) => {
        const r = await api.post<{ status: string; explanation?: string; nextSteps?: string[]; error?: string }>("/api/explain", { investigationId: inv.id }, opts.signal);
        if (r.status === "ok" && r.explanation && inv.conclusion) {
          inv.conclusion = { ...inv.conclusion, explanation: r.explanation, nextSteps: r.nextSteps?.length ? r.nextSteps : inv.conclusion.nextSteps, generatedBy: "ai" };
          s.detail = "Explanation generated from stored facts only";
        } else {
          s.status = r.status === "not_configured" ? "skipped" : "error";
          s.detail = r.error || "Using rules-based explanation";
        }
      });
    }
    run.status = "complete";
    run.finishedAt = nowIso();
    inv.status = "complete";
    if (inv.title === "Untitled investigation" || /^Investigation /.test(inv.title)) inv.title = autoTitle(inv);
    publish();
    await save();
    return inv;
  } catch (e) {
    run.status = e instanceof Cancelled ? "cancelled" : "error";
    run.error = e instanceof Error ? e.message : String(e);
    run.finishedAt = nowIso();
    inv.status = e instanceof Cancelled ? "complete" : "error";
    emit({ type: "log", text: run.error, level: e instanceof Cancelled ? "info" : "error" });
    publish();
    await save();
    if (e instanceof Cancelled) return inv;
    throw e;
  }
}

function autoTitle(inv: Investigation) {
  const top = inv.images[0]?.analysis?.scene?.[0]?.label;
  const lead = inv.candidates.find((c) => c.status === "leading");
  const kind = top ? top.replace(/\(.*\)/, "").trim() : "Image";
  return `${kind.charAt(0).toUpperCase() + kind.slice(1)} investigation${lead ? ` — ${lead.name}` : ""}`;
}

export function candidateLabel(c: Candidate, i: number) {
  return `#${i + 1} ${c.name}`;
}

export function embeddingFor(imageId: string) {
  return embeddings.get(imageId);
}
export function setEmbedding(imageId: string, e: Float32Array) {
  embeddings.set(imageId, e);
}

export type { ImageRecord };
