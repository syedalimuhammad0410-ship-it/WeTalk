import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { generatePrompt, restorePromptVersion, savePromptEdit, transformPrompt } from "@/lib/server/prompts/service";
import { fakeAi, makeWorkspace, noAi } from "../helpers";

async function lead() {
  const { ws, owner } = await makeWorkspace();
  const b = await db.business.create({ data: { workspaceId: ws.id, name: "Mike's Plumbing", normalizedName: "mikes plumbing", category: "Plumber", businessType: "plumber", city: "Brampton", phone: "(905) 555-0123" } });
  return { ws, owner, b };
}

describe("prompt generation service", () => {
  beforeEach(() => noAi());

  it("generates a high-quality rule-based prompt without AI and notes how to enable AI", async () => {
    const { ws, owner, b } = await lead();
    const r = await generatePrompt(ws.id, b.id, owner.id);
    expect(r.quality.score).toBeGreaterThanOrEqual(85);
    expect(r.notes.join(" ")).toMatch(/connect Anthropic/i);
    const v = await db.promptVersion.findFirstOrThrow({ where: { promptId: r.promptId } });
    expect(v.generator).toBe("RULES");
    expect(v.content).toContain("Mike's Plumbing");
    expect(v.content).toContain("(905) 555-0123");
  });

  it("accepts an AI enhancement that keeps structure and facts", async () => {
    const { ws, owner, b } = await lead();
    fakeAi({ prompt_generation: (p) => p.slice(p.indexOf("CURRENT SPECIFICATION:\n") + 23) + "\n\nEXTRA BUSINESS-SPECIFIC GUIDANCE: emphasise emergency drain calls (RECOMMENDATION).\n" });
    const r = await generatePrompt(ws.id, b.id, owner.id);
    const v = await db.promptVersion.findFirstOrThrow({ where: { promptId: r.promptId } });
    expect(v.generator).toBe("AI");
    expect(v.content).toContain("EXTRA BUSINESS-SPECIFIC GUIDANCE");
  });

  it("discards an AI revision that invents facts (anti-hallucination)", async () => {
    const { ws, owner, b } = await lead();
    fakeAi({ prompt_generation: (p) => p.slice(p.indexOf("CURRENT SPECIFICATION:\n") + 23) + "\nMike's Plumbing has served Brampton since 1987 with over 2,000 happy customers. Call (416) 555-9999.\n" });
    const r = await generatePrompt(ws.id, b.id, owner.id);
    expect(r.notes.join(" ")).toMatch(/introduced unverified details/);
    const v = await db.promptVersion.findFirstOrThrow({ where: { promptId: r.promptId } });
    expect(v.generator).toBe("RULES");
    expect(v.content).not.toContain("since 1987");
  });

  it("discards an AI revision that drops required sections", async () => {
    const { ws, owner, b } = await lead();
    fakeAi({ prompt_generation: () => "Build a modern website." });
    const r = await generatePrompt(ws.id, b.id, owner.id);
    expect(r.notes.join(" ")).toMatch(/dropped required sections/);
  });

  it("supports edit → version → transform → restore with history persisted", async () => {
    const { ws, owner, b } = await lead();
    const g = await generatePrompt(ws.id, b.id, owner.id);
    const v1 = await db.promptVersion.findFirstOrThrow({ where: { promptId: g.promptId, version: 1 } });
    const e = await savePromptEdit(ws.id, g.promptId, `${v1.content}\nMY EDIT`, owner.id);
    expect(e.version).toBe(2);
    const s = await transformPrompt(ws.id, g.promptId, "SHORTEN", owner.id);
    expect(s.version).toBe(3);
    const v3 = await db.promptVersion.findFirstOrThrow({ where: { promptId: g.promptId, version: 3 } });
    expect(v3.wordCount).toBeLessThan(v1.wordCount);
    const add = await transformPrompt(ws.id, g.promptId, "ADD_FEATURE", owner.id, "live_chat");
    const v4 = await db.promptVersion.findFirstOrThrow({ where: { promptId: g.promptId, version: add.version } });
    expect(v4.content).toContain("Live chat / messaging");
    const rem = await transformPrompt(ws.id, g.promptId, "REMOVE_FEATURE", owner.id, "emergency_cta");
    const v5 = await db.promptVersion.findFirstOrThrow({ where: { promptId: g.promptId, version: rem.version } });
    expect(v5.content).toContain("Explicitly excluded by request: Emergency service call-out");
    const restored = await restorePromptVersion(ws.id, g.promptId, 2, owner.id);
    const v = await db.promptVersion.findFirstOrThrow({ where: { promptId: g.promptId, version: restored.version } });
    expect(v.content).toContain("MY EDIT");
    expect(await db.promptVersion.count({ where: { promptId: g.promptId } })).toBe(6);
    const p = await db.generatedPrompt.findUniqueOrThrow({ where: { id: g.promptId } });
    expect(p.currentVersion).toBe(6);
  });

  it("includes campaign prompt strategy", async () => {
    const { ws, owner, b } = await lead();
    const c = await db.campaign.create({ data: { workspaceId: ws.id, name: "Brampton Plumbers", promptStrategy: "Lead with emergency service." } });
    await db.campaignLead.create({ data: { campaignId: c.id, businessId: b.id } });
    const r = await generatePrompt(ws.id, b.id, owner.id);
    const v = await db.promptVersion.findFirstOrThrow({ where: { promptId: r.promptId } });
    expect(v.content).toContain("Campaign “Brampton Plumbers”: Lead with emergency service.");
  });
});
