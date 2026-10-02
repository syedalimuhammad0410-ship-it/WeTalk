import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Investigation, InvestigationSummary } from "@/lib/types";
import { storage } from "./storage";
import { HttpError } from "./api";
import { nowIso, uid } from "@/lib/util";

const owner = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const docKey = (email: string, id: string) => `inv/${owner(email)}/${id}`;
const indexKey = (email: string) => `idx/${owner(email)}`;
export const imageKeyFor = (email: string, imageId: string) => `img/${owner(email)}/${imageId}`;
export const ownsImageKey = (email: string, key: string) => key.startsWith(`img/${owner(email)}/`);

const ID = z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/);
const arr = (max: number) => z.array(z.record(z.string(), z.unknown())).max(max);

/** Structural validation of client-submitted investigation documents. */
export const InvestigationSchema = z.object({
  id: ID,
  title: z.string().min(1).max(200),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40).optional(),
  mode: z.enum(["quick", "deep", "visual", "location", "document", "sports", "building", "historical", "custom"]),
  customInstructions: z.string().max(4000).optional(),
  status: z.enum(["draft", "running", "complete", "error"]),
  demo: z.boolean().optional(),
  focus: z.record(z.string(), z.unknown()).optional(),
  images: arr(24),
  regions: arr(200),
  clues: arr(1500),
  entities: arr(500),
  candidates: arr(100),
  locations: arr(500),
  evidence: arr(3000),
  sources: arr(2000),
  queries: arr(1000),
  results: arr(5000),
  timeline: arr(1000),
  contradictions: arr(300),
  chat: arr(1000),
  notes: arr(500),
  boards: arr(12),
  runs: arr(200),
  conclusion: z.record(z.string(), z.unknown()).optional(),
});

export function blankInvestigation(email: string, partial: Partial<Investigation> = {}): Investigation {
  const t = nowIso();
  return {
    id: uid("inv"),
    ownerEmail: email,
    title: "Untitled investigation",
    createdAt: t,
    updatedAt: t,
    mode: "deep",
    status: "draft",
    images: [],
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
    ...partial,
  };
}

function summarize(inv: Investigation): InvestigationSummary {
  const lead = inv.candidates.find((c) => c.id === inv.conclusion?.candidateId);
  return {
    id: inv.id,
    title: inv.title,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    mode: inv.mode,
    status: inv.status,
    thumbKey: inv.images[0]?.key,
    imageCount: inv.images.length,
    candidateCount: inv.candidates.length,
    sourceCount: inv.sources.length,
    headline: inv.conclusion?.headline || lead?.name,
    confidence: inv.conclusion?.confidence,
    demo: inv.demo,
  };
}

export async function listInvestigations(email: string): Promise<InvestigationSummary[]> {
  const idx = (await storage().getJSON<InvestigationSummary[]>(indexKey(email))) || [];
  return idx.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function updateIndex(email: string, fn: (idx: InvestigationSummary[]) => InvestigationSummary[]) {
  const s = storage();
  const idx = (await s.getJSON<InvestigationSummary[]>(indexKey(email))) || [];
  await s.setJSON(indexKey(email), fn(idx));
}

export async function getInvestigation(email: string, id: string): Promise<Investigation> {
  if (!ID.safeParse(id).success) throw new HttpError(400, "Invalid investigation id.");
  const inv = await storage().getJSON<Investigation>(docKey(email, id));
  if (!inv) throw new HttpError(404, "Investigation not found.");
  if (inv.ownerEmail.toLowerCase() !== email.toLowerCase()) throw new HttpError(403, "Forbidden.");
  return inv;
}

export async function saveInvestigation(email: string, input: unknown, opts: { create?: boolean } = {}): Promise<Investigation> {
  const parsed = InvestigationSchema.parse(input);
  const existing = await storage().getJSON<Investigation>(docKey(email, parsed.id));
  if (existing && existing.ownerEmail.toLowerCase() !== email.toLowerCase()) throw new HttpError(403, "Forbidden.");
  if (!existing && !opts.create) throw new HttpError(404, "Investigation not found.");
  const inv = { ...(parsed as unknown as Investigation), ownerEmail: email, updatedAt: nowIso() };
  // never trust client-provided image keys: keep only keys owned by this user
  inv.images = inv.images.filter((im) => typeof im.key === "string" && ownsImageKey(email, im.key));
  const size = JSON.stringify(inv).length;
  if (size > 8_000_000) throw new HttpError(413, "Investigation document too large.");
  await storage().setJSON(docKey(email, inv.id), inv);
  await updateIndex(email, (idx) => [summarize(inv), ...idx.filter((s) => s.id !== inv.id)]);
  return inv;
}

export async function createInvestigation(email: string, partial: Partial<Investigation>) {
  const inv = blankInvestigation(email, partial);
  await storage().setJSON(docKey(email, inv.id), inv);
  await updateIndex(email, (idx) => [summarize(inv), ...idx]);
  return inv;
}

export async function deleteInvestigation(email: string, id: string) {
  const inv = await getInvestigation(email, id);
  const s = storage();
  // secure deletion: remove image binaries that belong to this investigation
  for (const im of inv.images) if (ownsImageKey(email, im.key)) await s.delete(im.key).catch(() => undefined);
  await s.delete(docKey(email, id));
  await updateIndex(email, (idx) => idx.filter((x) => x.id !== id));
}

export async function duplicateInvestigation(email: string, id: string) {
  const inv = await getInvestigation(email, id);
  const copy: Investigation = {
    ...structuredClone(inv),
    id: uid("inv"),
    title: `${inv.title} (copy)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  // copy binaries so deleting one investigation never breaks the other
  const s = storage();
  for (const im of copy.images) {
    const bin = await s.getBinary(im.key);
    const newKey = imageKeyFor(email, uid("img"));
    if (bin) await s.setBinary(newKey, bin.data, bin.mime);
    im.key = newKey;
  }
  await storage().setJSON(docKey(email, copy.id), copy);
  await updateIndex(email, (idx) => [summarize(copy), ...idx]);
  return copy;
}
