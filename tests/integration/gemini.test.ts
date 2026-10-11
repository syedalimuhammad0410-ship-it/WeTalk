import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { db } from "@/lib/db";
import { getAi, setAiFactoryForTests } from "@/lib/server/ai/client";
import { GeminiProvider, resolveGeminiModel, setGeminiFetchForTests, testGeminiKey } from "@/lib/server/ai/gemini";
import { saveIntegrationKey } from "@/lib/server/workspace";
import { makeWorkspace } from "../helpers";

type Body = {
  systemInstruction: { parts: { text: string }[] };
  contents: { parts: { text: string }[] }[];
  generationConfig: { responseMimeType?: string; responseJsonSchema?: { $schema?: string; properties: Record<string, { enum?: string[] }> } };
};
type Call = { url: string; body: Body; key: string | null };
function fakeGemini(responder: (call: Call, n: number) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  setGeminiFetchForTests((async (url: string, init: RequestInit) => {
    const call = { url: String(url), body: init.body ? JSON.parse(String(init.body)) : null, key: new Headers(init.headers).get("x-goog-api-key") };
    calls.push(call);
    const r = responder(call, calls.length);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  return calls;
}
const answer = (text: string, finishReason = "STOP") => ({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text }] }, finishReason }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, thoughtsTokenCount: 3 } });
const Schema = z.object({ intent: z.enum(["INTERESTED", "QUESTION"]), confidence: z.number().int().min(0).max(100), notes: z.array(z.string()) });

describe("Google Gemini provider", () => {
  afterEach(() => setGeminiFetchForTests(null));

  it("returns schema-validated JSON, sends the key and structured-output config, ignores thought parts", async () => {
    const calls = fakeGemini(() => ({ json: answer(JSON.stringify({ intent: "QUESTION", confidence: 82, notes: ["asks about price"] })) }));
    const out = await new GeminiProvider("gem-key-123", "gemini-2.5-flash").json({ feature: "t", system: "sys", prompt: "hi", schema: Schema });
    expect(out.value).toEqual({ intent: "QUESTION", confidence: 82, notes: ["asks about price"] });
    expect(out.usage).toEqual({ input_tokens: 11, output_tokens: 10 });
    expect(calls[0]!.url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(calls[0]!.key).toBe("gem-key-123");
    expect(calls[0]!.body.systemInstruction.parts[0].text).toBe("sys");
    expect(calls[0]!.body.generationConfig.responseMimeType).toBe("application/json");
    expect(calls[0]!.body.generationConfig.responseJsonSchema!.properties.intent.enum).toEqual(["INTERESTED", "QUESTION"]);
    expect(calls[0]!.body.generationConfig.responseJsonSchema!.$schema).toBeUndefined();
  });

  it("retries with the schema in the prompt when the model rejects the schema", async () => {
    const calls = fakeGemini((_c, n) => (n === 1 ? { status: 400, json: { error: { message: "Invalid JSON payload: unsupported keyword", status: "INVALID_ARGUMENT" } } } : { json: answer("```json\n" + JSON.stringify({ intent: "INTERESTED", confidence: 90, notes: [] }) + "\n```") }));
    const out = await new GeminiProvider("k", "gemini-2.5-flash").json({ feature: "t", system: "s", prompt: "p", schema: Schema });
    expect(out.value.intent).toBe("INTERESTED");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.generationConfig.responseJsonSchema).toBeUndefined();
    expect(calls[1]!.body.contents[0].parts[0].text).toContain("matches this JSON Schema");
  });

  it("never saves output that fails validation, is cut off or is blocked", async () => {
    fakeGemini(() => ({ json: answer(JSON.stringify({ intent: "SOMETHING_ELSE", confidence: 500, notes: [] })) }));
    await expect(new GeminiProvider("k", "m").json({ feature: "t", system: "s", prompt: "p", schema: Schema })).rejects.toThrow(/did not match/);
    fakeGemini(() => ({ json: answer("partial", "MAX_TOKENS") }));
    await expect(new GeminiProvider("k", "m").text({ feature: "t", system: "s", prompt: "p" })).rejects.toThrow(/cut off/);
    fakeGemini(() => ({ json: answer("", "SAFETY") }));
    await expect(new GeminiProvider("k", "m").text({ feature: "t", system: "s", prompt: "p" })).rejects.toThrow(/declined/);
  });

  it("maps API errors to clear messages", async () => {
    fakeGemini(() => ({ status: 400, json: { error: { message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } } }));
    expect(await testGeminiKey("bad")).toEqual({ ok: false, error: expect.stringMatching(/rejected the Gemini API key/) });
    fakeGemini(() => ({ status: 429, json: { error: { message: "You exceeded your current quota, please check your plan and billing details.", status: "RESOURCE_EXHAUSTED" } } }));
    await expect(new GeminiProvider("k", "m").text({ feature: "t", system: "s", prompt: "p" })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  it("picks the newest stable Flash model the key can use", async () => {
    fakeGemini(() => ({
      json: {
        models: [
          { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-9-flash-preview-05", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        ],
      },
    }));
    expect(await resolveGeminiModel("key-a")).toBe("gemini-2.5-flash");
    expect(await resolveGeminiModel("key-a", "gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

describe("AI provider selection", () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, g: process.env.GEMINI_API_KEY };
  beforeEach(() => {
    setAiFactoryForTests(null);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    fakeGemini(() => ({ json: { models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] } }));
  });
  afterEach(() => {
    setGeminiFetchForTests(null);
    for (const [k, v] of [["ANTHROPIC_API_KEY", saved.a], ["GEMINI_API_KEY", saved.g]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("uses Gemini when it is the only key, Anthropic when both exist, nothing when neither", async () => {
    const { ws } = await makeWorkspace();
    expect(await getAi(ws.id)).toBeNull();
    await db.integrationCredential.deleteMany({ where: { workspaceId: ws.id } });
    await saveIntegrationKey(ws.id, "GEMINI", "gemini-test-key-123");
    expect((await getAi(ws.id))?.model).toBe("gemini-2.5-flash");
    await saveIntegrationKey(ws.id, "ANTHROPIC", "sk-ant-test-key-123");
    expect((await getAi(ws.id))?.model).toMatch(/^claude/);
  });

  it("records Gemini usage like any other AI call", async () => {
    const { ws } = await makeWorkspace();
    await saveIntegrationKey(ws.id, "GEMINI", "gemini-test-key-456");
    const ai = (await getAi(ws.id))!;
    fakeGemini(() => ({ json: answer("Hello from Gemini") }));
    expect(await ai.text({ feature: "unit-test", system: "s", prompt: "p" })).toBe("Hello from Gemini");
    const usage = await db.aiUsage.findFirst({ where: { workspaceId: ws.id, feature: "unit-test" } });
    expect(usage).toMatchObject({ model: "gemini-2.5-flash", inputTokens: 11, outputTokens: 10, success: true });
  });
});
