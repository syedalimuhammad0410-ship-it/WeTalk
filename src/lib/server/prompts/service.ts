import "../guard";
import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity } from "../activity";
import { getAi, type AiProvider } from "../ai/client";
import { FEATURES } from "../intel/features";
import { composeMasterPrompt, REQUIRED_SECTIONS } from "./composer";
import { loadPromptContext, type PromptContext, type PromptOptions } from "./context";
import { findUnsupportedClaims, QUALITY_LABELS, scorePrompt, type QualityReport } from "./quality";

export const QUALITY_TARGET = 85;

type Candidate = { content: string; generator: "RULES" | "AI"; quality: QualityReport; notes: string[] };

const SYSTEM_PROMPT = `You are a senior web strategist, UX designer, conversion specialist, SEO specialist and front-end architect writing an implementation specification that another AI coding agent will follow to build a website for a specific local business.

Absolute rules:
- Use ONLY the facts in the FACTS block. Do not add phone numbers, emails, addresses, prices, hours, years, team names, ratings, review counts, awards, certifications, customer counts or any other factual detail that is not in FACTS.
- Keep every placeholder in square brackets. Where information is missing, add more placeholders rather than guessing.
- Clearly label assumptions as INFERRED and suggestions as RECOMMENDATION.
- Keep every numbered section heading exactly as written (including the ===== rules) and in the same order.
- Output only the specification text — no preamble, no commentary, no markdown code fences.`;

function factsBlock(ctx: PromptContext) {
  return [
    ...ctx.facts.map((f) => `${f.label}: ${f.value} (source: ${f.source})`),
    ...ctx.servicesVerified.map((s) => `Service stated on website: ${s.name} — “${s.evidence}”`),
    ...ctx.differentiators.map((s) => `Claim on website: ${s.claim} — “${s.evidence}”`),
  ].join("\n");
}

async function aiRewrite(ai: AiProvider, ctx: PromptContext, base: string, instruction: string, feature: string): Promise<{ content: string | null; note: string }> {
  try {
    const content = await ai.text({
      feature,
      system: SYSTEM_PROMPT,
      prompt: `FACTS (the only verified information):\n${factsBlock(ctx)}\n\nBUSINESS TYPE: ${ctx.playbook.label}\nOPPORTUNITY REASONS: ${ctx.opportunityReasons.map((r) => `${r.label} (${r.kind})`).join("; ")}\n\nTASK: ${instruction}\n\nCURRENT SPECIFICATION:\n${base}`,
      maxTokens: 64000,
    });
    const cleaned = content.replace(/^```[a-z]*\n?|```$/g, "").trim() + "\n";
    const missing = REQUIRED_SECTIONS.filter((s) => !cleaned.includes(s));
    if (missing.length) return { content: null, note: `AI revision dropped required sections (${missing.slice(0, 3).join(", ")}); kept the previous version.` };
    const trusted = `${base}\n${factsBlock(ctx)}`;
    const unsupported = findUnsupportedClaims(cleaned, trusted);
    if (unsupported.length) {
      return { content: null, note: `AI revision introduced unverified details (${unsupported.slice(0, 4).map((u) => `${u.type}: “${u.value}”`).join(", ")}); it was discarded to protect accuracy.` };
    }
    return { content: cleaned, note: "AI-enhanced and fact-checked against verified information." };
  } catch (e) {
    return { content: null, note: `AI enhancement unavailable: ${describeError(e)}` };
  }
}

function weakDimensions(q: QualityReport) {
  return Object.entries(q.dimensions)
    .filter(([, v]) => v.score < 9)
    .sort((a, b) => a[1].score - b[1].score)
    .map(([k, v]) => `${QUALITY_LABELS[k as keyof typeof QUALITY_LABELS]} (${v.score}/10: ${v.notes.join("; ")})`);
}

/** Full generation pipeline: compose → (AI enhance) → score → auto-improve below target. */
export async function buildBestPrompt(ctx: PromptContext, opts: { useAi: boolean; workspaceId: string }): Promise<Candidate> {
  const notes: string[] = [];
  let content = composeMasterPrompt(ctx);
  let generator: Candidate["generator"] = "RULES";
  let quality = scorePrompt(content, ctx);
  notes.push(`Rule-based draft scored ${quality.score}/100.`);

  const ai = opts.useAi ? await getAi(opts.workspaceId) : null;
  if (opts.useAi && !ai) notes.push("AI enhancement skipped: connect Anthropic in Settings → Integrations to enable it.");
  if (ai) {
    const r = await aiRewrite(
      ai,
      ctx,
      content,
      `Deepen this specification for ${ctx.business.name} specifically. Make page content guidance, hero copy direction, feature rationale, conversion strategy and edge cases more specific to a ${ctx.playbook.label.toLowerCase()}${ctx.city ? ` in ${ctx.city}` : ""} and to the audit findings. Keep it at least as detailed as the current version.`,
      "prompt_generation",
    );
    notes.push(r.note);
    if (r.content) {
      const q = scorePrompt(r.content, ctx);
      if (q.score >= quality.score - 2) {
        content = r.content;
        quality = q;
        generator = "AI";
      } else notes.push(`AI revision scored lower (${q.score}); kept rule-based draft.`);
    }
  }

  for (let round = 1; quality.score < QUALITY_TARGET && round <= 2; round++) {
    notes.push(`Quality ${quality.score} below ${QUALITY_TARGET}; automatic improvement round ${round}.`);
    if (ctx.options.detail !== "detailed") {
      ctx = { ...ctx, options: { ...ctx.options, detail: "detailed" } };
      const c = composeMasterPrompt(ctx);
      const q = scorePrompt(c, ctx);
      if (q.score > quality.score) {
        content = c;
        quality = q;
        generator = "RULES";
        continue;
      }
    }
    if (ai) {
      const r = await aiRewrite(ai, ctx, content, `Improve these weak areas without removing anything: ${weakDimensions(quality).join(" | ")}`, "prompt_improvement");
      notes.push(r.note);
      if (r.content) {
        const q = scorePrompt(r.content, ctx);
        if (q.score > quality.score) {
          content = r.content;
          quality = q;
          generator = "AI";
        }
      }
    }
  }
  if (quality.score < QUALITY_TARGET) notes.push(`Final quality ${quality.score}/100 — limited by missing business information (see Unknown Information).`);
  return { content, generator, quality, notes };
}

export async function generatePrompt(workspaceId: string, businessId: string, userId: string | null, options: PromptOptions = {}) {
  const [settings, existing] = await Promise.all([
    db.automationSettings.findUnique({ where: { workspaceId } }),
    db.generatedPrompt.findFirst({ where: { workspaceId, businessId }, orderBy: { createdAt: "desc" } }),
  ]);
  const merged: PromptOptions = {
    ...((existing?.options ?? {}) as PromptOptions),
    ...options,
    extraInstructions: options.extraInstructions ?? settings?.promptBehavior ?? "",
  };
  const ctx = await loadPromptContext(workspaceId, businessId, merged);
  const best = await buildBestPrompt(ctx, { useAi: settings?.aiPromptGeneration !== false, workspaceId });
  const saved = await saveVersion({
    workspaceId,
    businessId,
    promptId: existing?.id ?? null,
    title: `${ctx.business.name} — website master prompt`,
    content: best.content,
    changeType: existing ? "REGENERATED" : "GENERATED",
    generator: best.generator,
    quality: best.quality,
    note: best.notes.join(" "),
    userId,
    options: { detail: ctx.options.detail, addFeatures: ctx.options.addFeatures, removeFeatures: ctx.options.removeFeatures },
  });
  await logActivity({ workspaceId, userId, businessId, action: "prompt.generated", summary: `Website prompt ${existing ? "regenerated" : "generated"} (quality ${best.quality.score}/100, ${best.generator === "AI" ? "AI-enhanced" : "rule-based"})`, details: { promptId: saved.promptId, version: saved.version } });
  return { ...saved, notes: best.notes, quality: best.quality };
}

async function saveVersion(i: {
  workspaceId: string;
  businessId: string;
  promptId: string | null;
  title: string;
  content: string;
  changeType: string;
  generator: string;
  quality: QualityReport | null;
  note?: string;
  userId: string | null;
  options?: PromptOptions;
}) {
  return db.$transaction(async (tx) => {
    let promptId = i.promptId;
    let version = 1;
    if (!promptId) {
      const p = await tx.generatedPrompt.create({
        data: { workspaceId: i.workspaceId, businessId: i.businessId, title: i.title, createdById: i.userId, qualityScore: i.quality?.score ?? null, options: (i.options ?? {}) as Prisma.InputJsonValue },
      });
      promptId = p.id;
    } else {
      const last = await tx.promptVersion.findFirst({ where: { promptId }, orderBy: { version: "desc" } });
      version = (last?.version ?? 0) + 1;
      await tx.generatedPrompt.update({
        where: { id: promptId },
        data: { currentVersion: version, qualityScore: i.quality?.score ?? null, ...(i.options ? { options: i.options as Prisma.InputJsonValue } : {}) },
      });
    }
    await tx.promptVersion.create({
      data: {
        promptId,
        version,
        content: i.content,
        changeType: i.changeType,
        generator: i.generator,
        note: i.note ?? null,
        qualityScore: i.quality?.score ?? null,
        qualityBreakdown: (i.quality?.dimensions ?? undefined) as Prisma.InputJsonValue | undefined,
        wordCount: i.content.split(/\s+/).filter(Boolean).length,
        createdById: i.userId,
      },
    });
    if (version === 1 && i.promptId === null) {
      /* first version — currentVersion default 1 */
    }
    return { promptId, version };
  });
}

async function loadPrompt(workspaceId: string, promptId: string) {
  const p = await db.generatedPrompt.findFirst({ where: { id: promptId, workspaceId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!p) throw new AppError("NOT_FOUND", "Prompt not found.");
  return p;
}

export async function savePromptEdit(workspaceId: string, promptId: string, content: string, userId: string) {
  const p = await loadPrompt(workspaceId, promptId);
  if (!content.trim()) throw new AppError("VALIDATION", "The prompt cannot be empty.");
  if (p.versions[0]?.content === content) return { promptId, version: p.currentVersion, unchanged: true };
  const ctx = await loadPromptContext(workspaceId, p.businessId, p.options as PromptOptions);
  const quality = scorePrompt(content, ctx);
  const saved = await saveVersion({ workspaceId, businessId: p.businessId, promptId, title: p.title, content, changeType: "EDITED", generator: "MANUAL", quality, userId });
  await logActivity({ workspaceId, userId, businessId: p.businessId, action: "prompt.edited", summary: `Prompt edited manually (v${saved.version})` });
  return { ...saved, quality };
}

export type PromptTransform = "IMPROVE" | "SHORTEN" | "EXPAND" | "ADD_FEATURE" | "REMOVE_FEATURE";

export async function transformPrompt(workspaceId: string, promptId: string, op: PromptTransform, userId: string, arg?: string) {
  const p = await loadPrompt(workspaceId, promptId);
  const current = p.versions[0]?.content ?? "";
  const opts = { ...((p.options ?? {}) as PromptOptions) };
  if (op === "ADD_FEATURE" || op === "REMOVE_FEATURE") {
    if (!arg || !FEATURES[arg]) throw new AppError("VALIDATION", "Choose a valid feature.");
    if (op === "ADD_FEATURE") {
      opts.addFeatures = Array.from(new Set([...(opts.addFeatures ?? []), arg]));
      opts.removeFeatures = (opts.removeFeatures ?? []).filter((k) => k !== arg);
    } else {
      opts.removeFeatures = Array.from(new Set([...(opts.removeFeatures ?? []), arg]));
      opts.addFeatures = (opts.addFeatures ?? []).filter((k) => k !== arg);
    }
  }
  if (op === "SHORTEN") opts.detail = "concise";
  if (op === "EXPAND") opts.detail = "detailed";
  const ctx = await loadPromptContext(workspaceId, p.businessId, opts);
  const settings = await db.automationSettings.findUnique({ where: { workspaceId } });
  const ai = settings?.aiPromptGeneration !== false ? await getAi(workspaceId) : null;
  const wasEdited = p.versions[0]?.generator === "MANUAL";

  let content: string;
  let generator = "RULES";
  const notes: string[] = [];
  const instructions: Record<PromptTransform, string> = {
    IMPROVE: "Improve clarity, specificity to this business, and completeness. Fix vague instructions. Keep all content that is useful.",
    SHORTEN: "Make this specification more concise (roughly 50–60% of current length) while keeping every section heading, all factuality rules, all placeholders, the forms field lists and the acceptance criteria.",
    EXPAND: "Make this specification more detailed: deeper page-by-page content guidance, more edge cases, more precise component behaviour, richer conversion strategy — specific to this business.",
    ADD_FEATURE: `Add the feature “${arg ? FEATURES[arg]?.name : ""}” throughout the specification (functionality, relevant pages, forms, analytics, acceptance criteria). Implementation notes: ${arg ? FEATURES[arg]?.spec.join(" ") : ""}`,
    REMOVE_FEATURE: `Remove the feature “${arg ? FEATURES[arg]?.name : ""}” everywhere in the specification (pages, functionality, forms, analytics, acceptance criteria) and state explicitly that it must not be built.`,
  };
  if (ai) {
    const r = await aiRewrite(ai, ctx, current, instructions[op], `prompt_${op.toLowerCase()}`);
    notes.push(r.note);
    if (r.content) {
      content = r.content;
      generator = "AI";
    } else content = composeMasterPrompt(ctx);
  } else {
    content = composeMasterPrompt(ctx);
    if (op === "IMPROVE") {
      const best = await buildBestPrompt({ ...ctx, options: { ...ctx.options, detail: "detailed" } }, { useAi: false, workspaceId });
      content = best.content;
    }
    notes.push("Rebuilt from structured business data (connect Anthropic for AI-assisted editing that preserves manual edits).");
    if (wasEdited) notes.push("Your manual edits remain available in version history.");
  }
  const quality = scorePrompt(content, ctx);
  const changeType = { IMPROVE: "IMPROVED", SHORTEN: "SHORTENED", EXPAND: "EXPANDED", ADD_FEATURE: "FEATURE_ADDED", REMOVE_FEATURE: "FEATURE_REMOVED" }[op];
  const saved = await saveVersion({ workspaceId, businessId: p.businessId, promptId, title: p.title, content, changeType, generator, quality, note: notes.join(" "), userId, options: opts });
  await logActivity({ workspaceId, userId, businessId: p.businessId, action: "prompt.edited", summary: `Prompt ${changeType.toLowerCase().replace("_", " ")} (v${saved.version}, quality ${quality.score})`, details: { op, arg: arg ?? null } });
  return { ...saved, quality, notes };
}

export async function restorePromptVersion(workspaceId: string, promptId: string, version: number, userId: string) {
  const p = await loadPrompt(workspaceId, promptId);
  const v = await db.promptVersion.findUnique({ where: { promptId_version: { promptId, version } } });
  if (!v) throw new AppError("NOT_FOUND", `Version ${version} not found.`);
  const saved = await saveVersion({
    workspaceId,
    businessId: p.businessId,
    promptId,
    title: p.title,
    content: v.content,
    changeType: "RESTORED",
    generator: v.generator,
    quality: v.qualityScore != null ? { score: v.qualityScore, dimensions: v.qualityBreakdown as QualityReport["dimensions"] } : null,
    note: `Restored from version ${version}`,
    userId,
  });
  await logActivity({ workspaceId, userId, businessId: p.businessId, action: "prompt.restored", summary: `Prompt restored to version ${version} (as v${saved.version})` });
  return saved;
}
