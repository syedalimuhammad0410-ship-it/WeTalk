import { describe, expect, it } from "vitest";
import entFix from "./fixtures/entities-hawks.json";
import candFix from "./fixtures/candidates-hawks.json";
import type { Clue, Investigation } from "@/lib/types";
import type { ResearchDelta } from "@/lib/engine/protocol";
import { mergeDelta } from "@/lib/engine/merge";
import { assess } from "@/lib/engine/reasoning";
import { buildBoard } from "@/lib/engine/graph";
import { answer } from "@/lib/engine/intents";
import { toCsv, toJson, toMarkdown } from "@/lib/engine/report";
import { textSupport, yearOf } from "@/lib/util";

// Fixtures are real responses recorded from TRACE's /api/entities and /api/candidates
// (Wikipedia + Wikidata) for OCR text read from a public 2010 Hawks–Bucks photo.

function blank(): Investigation {
  const t = new Date().toISOString();
  return {
    id: "inv_test",
    ownerEmail: "t@example.com",
    title: "test",
    createdAt: t,
    updatedAt: t,
    mode: "sports",
    status: "running",
    images: [{ id: "img1", name: "court.jpg", key: "img/x/img1", mime: "image/jpeg", size: 1, width: 1600, height: 1067, sha256: "0".repeat(64), createdAt: t }],
    regions: [],
    clues: [],
    entities: [],
    candidates: [],
    locations: [],
    evidence: [],
    sources: [],
    queries: [],
    results: [],
    timeline: [],
    contradictions: [],
    chat: [],
    notes: [],
    boards: [],
    runs: [],
  };
}

const clue = (value: string, weight: number, type: Clue["type"] = "text"): Clue => ({ id: `c_${value}`, imageId: "img1", type, label: "Text", value, weight, origin: "ocr", engine: "tesseract" });

function build(extra: Partial<Investigation> = {}) {
  let inv = blank();
  inv.clues = [clue("HAWKS", 0.8), clue("IPS ARENA", 0.7), clue("SPALDING", 0.9), clue("State Farm", 0.85), clue("BUCKS", 0.75), clue("basketball court", 0.8, "scene")];
  inv = mergeDelta(inv, entFix as unknown as ResearchDelta);
  inv = mergeDelta(inv, candFix as unknown as ResearchDelta);
  return assess({ ...inv, ...extra });
}

describe("text matching", () => {
  it("treats partial OCR reads as partial matches", () => {
    expect(textSupport("IPS ARENA", "Philips Arena").score).toBeGreaterThan(0.75);
    expect(textSupport("State", "Michigan State Spartans men's basketball").score).toBeLessThan(0.6);
    expect(textSupport("BROADWAY", "Broadway").how).toBe("exact");
  });
  it("extracts years", () => {
    expect(yearOf("+2018-08-29")).toBe(2018);
    expect(yearOf("no year")).toBeUndefined();
  });
});

describe("investigation reasoning (real Wikidata fixture)", () => {
  it("merges candidates without duplicates and keeps source references valid", () => {
    const inv = build();
    const ids = inv.candidates.map((c) => c.wikidataId);
    expect(new Set(ids).size).toBe(ids.length);
    const srcIds = new Set(inv.sources.map((s) => s.id));
    for (const c of inv.candidates) for (const s of c.sourceIds) expect(srcIds.has(s)).toBe(true);
  });

  it("leads with State Farm Arena because visible text matches its former name (Philips Arena)", () => {
    const inv = build();
    const lead = inv.candidates.find((c) => c.status === "leading");
    expect(lead?.name).toBe("State Farm Arena");
    expect(lead!.why.join(" ")).toMatch(/IPS ARENA/);
    expect(lead!.why.join(" ")).toMatch(/Philips Arena/);
    expect(inv.conclusion?.headline).toMatch(/State Farm Arena/);
    // never claims certainty without visual comparison / date
    expect(inv.conclusion?.confidence).not.toBe("high");
    expect(lead!.falsification?.length).toBeGreaterThan(3);
  });

  it("surfaces the away-game alternative (other team's branding) as contradicting/limiting evidence", () => {
    const inv = build();
    const lead = inv.candidates.find((c) => c.status === "leading")!;
    expect(lead.against.join(" ")).toMatch(/away game|Milwaukee Bucks/);
    expect(inv.candidates.some((c) => c.name === "Bradley Center")).toBe(true);
  });

  it("uses a user-provided year as user evidence and checks it against tenancy periods", () => {
    const note = { id: "n1", text: "I think this was taken in 2010", createdAt: new Date().toISOString(), tags: [], yearHint: 2010 };
    const inv = build({ notes: [note] });
    const lead = inv.candidates.find((c) => c.status === "leading")!;
    expect(lead.name).toBe("State Farm Arena");
    const ev = inv.evidence.filter((e) => e.candidateId === lead.id && e.kind === "user");
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.some((e) => e.polarity === "supports")).toBe(true);
    // Omni Coliseum (1972–1997) is inconsistent with 2010
    const omni = inv.candidates.find((c) => c.name === "Omni Coliseum")!;
    expect(omni.against.join(" ")).toMatch(/outside/);
  });

  it("rejects a candidate when the photo's GPS metadata is far away", () => {
    const inv0 = build();
    inv0.images[0].analysis = { analyzedAt: "", engines: [], scene: [], objects: [], ocr: [], colors: [], brightness: 0, skyShare: 0, indoorLikely: null, exif: { lat: 43.0436, lng: -87.9169 }, warnings: [] }; // Milwaukee
    const inv = assess(inv0);
    const sfa = inv.candidates.find((c) => c.name === "State Farm Arena")!;
    expect(sfa.status).toBe("rejected");
    expect(sfa.rejectionReason).toMatch(/km away|GPS/);
  });

  it("returns insufficient evidence when there are no candidates", () => {
    const inv = assess({ ...blank(), clues: [clue("blurry", 0.2)] });
    expect(inv.conclusion?.confidence).toBe("insufficient");
    expect(inv.conclusion?.headline).toMatch(/Insufficient evidence/);
  });

  it("builds an evidence graph image → clue → entity → candidate → location", () => {
    const inv = build();
    const b = buildBoard(inv);
    const kinds = new Set(b.nodes.map((n) => n.data.kind));
    for (const k of ["image", "clue", "entity", "candidate", "location", "source", "conclusion"]) expect(kinds.has(k as never)).toBe(true);
    expect(b.edges.some((e) => e.label === "played at")).toBe(true);
    expect(b.edges.some((e) => e.label === "located at")).toBe(true);
  });
});

describe("assistant intents (no AI key)", () => {
  it("answers from state and proposes actions", () => {
    const inv = build();
    expect(answer(inv, "Reset the investigation").actions[0].type).toBe("reset");
    expect(answer(inv, "What other locations could this be?").reply).toMatch(/Other possibilities/);
    expect(answer(inv, "Why did you reject candidate #2?").reply.length).toBeGreaterThan(10);
    expect(answer(inv, "Focus only on the logo").actions[0].payload).toMatchObject({ focus: { clueTypes: ["logo"] } });
    expect(answer(inv, "Search news about this venue").actions[0]).toMatchObject({ type: "search", payload: { kind: "news" } });
    expect(answer(inv, "Show me all sources").sourceIds?.length).toBeGreaterThan(0);
    expect(answer(inv, "Create a timeline").reply).toMatch(/Timeline/);
  });
});

describe("exports", () => {
  it("produces JSON/CSV/Markdown without the owner email", () => {
    const inv = build();
    const json = toJson(inv);
    expect(json).not.toContain("t@example.com");
    expect(JSON.parse(json).investigation.candidates.length).toBe(inv.candidates.length);
    expect(toCsv(inv).split("\n")[0]).toMatch(/^section,/);
    const md = toMarkdown(inv);
    expect(md).toMatch(/## Sources/);
    expect(md).toMatch(/State Farm Arena/);
  });
});
