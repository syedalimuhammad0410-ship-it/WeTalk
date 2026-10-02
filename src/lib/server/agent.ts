import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatAction, Investigation } from "@/lib/types";
import type { ResearchDelta } from "@/lib/engine/protocol";
import { anthropicClient } from "@/lib/providers/ai";
import { mapProvider } from "@/lib/providers/maps";
import type { ProviderContext } from "./settings";
import { runSearch } from "./research";
import { recordUsage } from "./usage";
import { truncate } from "@/lib/util";

export function digest(inv: Investigation) {
  return JSON.stringify({
    title: inv.title,
    mode: inv.mode,
    focus: inv.focus,
    images: inv.images.map((i) => ({ id: i.id, name: i.name, scene: i.analysis?.scene.slice(0, 3).map((s) => s.label), exif: i.analysis?.exif })),
    clues: inv.clues.filter((c) => !c.ignored).slice(0, 40).map((c) => ({ id: c.id, type: c.type, value: truncate(c.value, 80), engine: c.engine })),
    ignoredClues: inv.clues.filter((c) => c.ignored).map((c) => c.value).slice(0, 10),
    entities: inv.entities.slice(0, 20).map((e) => ({ name: e.name, type: e.type, match: e.matchQuality, because: e.detectedBecause[0] })),
    candidates: inv.candidates.map((c, i) => ({
      n: i + 1,
      id: c.id,
      name: c.name,
      city: c.city,
      status: c.status,
      confidence: c.confidence,
      why: c.why.slice(0, 5),
      against: c.against.slice(0, 5),
      rejection: c.rejectionReason,
      sources: c.sourceIds.slice(0, 6),
      falsification: c.falsification,
    })),
    evidence: inv.evidence.slice(0, 50).map((e) => ({ kind: e.kind, polarity: e.polarity, strength: e.strength, statement: e.statement, sources: e.sourceIds.slice(0, 3) })),
    contradictions: inv.contradictions.slice(0, 10),
    timeline: inv.timeline.slice(0, 30).map((t) => `${t.date}: ${t.label}`),
    notes: inv.notes.map((n) => n.text),
    conclusion: inv.conclusion,
    sources: inv.sources.slice(0, 80).map((s) => ({ id: s.id, title: truncate(s.title, 80), publisher: s.publisher, category: s.category, verified: s.verified, used: s.usedInReasoning })),
    queries: inv.queries.slice(-30).map((q) => `${q.kind}:${q.text} [${q.status}]`),
  });
}

const SYSTEM = `You are TRACE AI, the investigation assistant inside TRACE, a responsible visual-investigation tool for identifying PUBLIC places, venues, buildings, organizations, objects and documents from images.

Hard rules (no exceptions):
- Never invent sources, URLs, search results, images, locations or API responses. Only cite sources by their exact id in the form [source:ID], using ids present in the investigation state or returned by your tools.
- Never claim a search, comparison or analysis happened unless it appears in the state or you just ran it with a tool.
- Distinguish DIRECT evidence, INDIRECT evidence, INFERENCE and USER-PROVIDED information explicitly.
- Express confidence only as high / moderate / low / insufficient, with reasons. Surface contradicting evidence; never hide it.
- Actively consider what would disprove the leading candidate.
- Privacy: do not identify private individuals, do not infer residents or private addresses, do not help track people. Decline such requests briefly and redirect to public-place research.
- To change the app (reset, re-run, focus, ignore a clue, open a tab, add a note, export, enhance), call the ui_action tool. Reset must be proposed for user confirmation, never assumed.
- Be concise. Use short paragraphs or bullet lists.`;

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "search",
    description: "Run a real search through TRACE's configured providers. kind: web | news | videos | images | history. Returns results with source ids you may cite.",
    input_schema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["web", "news", "videos", "images", "history"] }, query: { type: "string" }, officialOnly: { type: "boolean" } },
      required: ["kind", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "geocode",
    description: "Look up a public place or address on the map provider. Returns coordinates and a map URL.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "ui_action",
    description:
      "Ask the TRACE app to perform an action. type: reset | rerun | ignore_clue | show_tab | add_note | export | search | map_search. payload examples: rerun {focus:{clueTypes:['logo'],instruction:'...'}}; ignore_clue {match:'basketball'}; show_tab {tab:'map'|'board'|'sources'|'timeline'|'candidates'|'compare'|'image'|'result', candidateId?}; add_note {text}.",
    input_schema: {
      type: "object",
      properties: { type: { type: "string" }, label: { type: "string" }, payload: { type: "object" } },
      required: ["type", "label"],
      additionalProperties: false,
    },
  },
];

export async function runAgent(ctx: ProviderContext, inv: Investigation, message: string): Promise<{ reply: string; actions: ChatAction[]; delta: ResearchDelta; sourceIds: string[] } | null> {
  const client = anthropicClient(ctx);
  if (!client) return null;
  const delta: ResearchDelta = { queries: [], results: [], sources: [] };
  const actions: ChatAction[] = [];
  const history: Anthropic.Beta.BetaMessageParam[] = inv.chat.slice(-12).map((m) => ({ role: m.role, content: m.content || "(empty)" }));
  // ensure alternation starts with user
  while (history.length && history[0].role !== "user") history.shift();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history,
    { role: "user", content: `CURRENT INVESTIGATION STATE (JSON):\n${digest(inv)}\n\nUSER MESSAGE:\n${message}` },
  ];
  // merge consecutive same-role messages
  const merged: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role && typeof last.content === "string" && typeof m.content === "string") last.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  let text = "";
  const started = Date.now();
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: ctx.prefs.aiModel || "claude-opus-5-5",
      max_tokens: 3000,
      system: SYSTEM,
      tools,
      tool_choice: { type: "auto" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      messages: merged,
    });
    recordUsage({ at: new Date().toISOString(), provider: "anthropic", op: "chat", ok: true, ms: Date.now() - started, costUnits: res.usage.input_tokens + res.usage.output_tokens });
    if (res.stop_reason === "refusal") return { reply: "I can't help with that request. I can help investigate public places, venues, buildings, organizations and documents.", actions, delta, sourceIds: [] };
    text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    const uses = res.content.filter((b) => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlock[];
    if (res.stop_reason !== "tool_use" || !uses.length) break;
    merged.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    await Promise.all(
      uses.map(async (u) => {
        const input = (u.input || {}) as Record<string, unknown>;
        try {
          if (u.name === "search") {
            const kind = String(input.kind || "web") as "web";
            const d = await runSearch({ kind, query: String(input.query || "").slice(0, 300), branch: "chat", officialOnly: Boolean(input.officialOnly) }, ctx);
            delta.queries.push(...d.queries);
            delta.results.push(...d.results);
            delta.sources.push(...d.sources);
            const status = d.queries.map((q) => `${q.provider}: ${q.status}${q.error ? ` (${q.error})` : ""}`).join("; ");
            results.push({
              type: "tool_result",
              tool_use_id: u.id,
              content: JSON.stringify({ status, results: d.results.slice(0, 8).map((r) => ({ source_id: r.sourceId, title: r.title, url: r.url, snippet: truncate(r.snippet, 240), date: r.publishedAt })) }),
            });
          } else if (u.name === "geocode") {
            const r = await mapProvider(ctx).geocode(String(input.query || "").slice(0, 300), 4);
            results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify({ status: r.status, error: r.error, places: r.items.map((p) => ({ name: p.name, address: p.displayName, lat: p.lat, lng: p.lng, url: p.url })) }) });
          } else if (u.name === "ui_action") {
            actions.push({ type: String(input.type), label: String(input.label || input.type), payload: (input.payload as Record<string, unknown>) || {}, status: "proposed" });
            results.push({ type: "tool_result", tool_use_id: u.id, content: "Action queued for the app. Reset requires the user's confirmation." });
          } else results.push({ type: "tool_result", tool_use_id: u.id, content: "Unknown tool", is_error: true });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: `Tool failed: ${e instanceof Error ? e.message : String(e)}`, is_error: true });
        }
      }),
    );
    merged.push({ role: "user", content: results });
  }
  const valid = new Set([...inv.sources.map((s) => s.id), ...delta.sources.map((s) => s.id)]);
  const cited = Array.from(text.matchAll(/\[source:([a-zA-Z0-9_]+)\]/g)).map((m) => m[1]);
  // strip any citation that does not resolve to a real source (no fabricated citations)
  const clean = text.replace(/\[source:([a-zA-Z0-9_]+)\]/g, (all, id) => (valid.has(id) ? all : "[unverified citation removed]"));
  return { reply: clean || "Done.", actions, delta, sourceIds: cited.filter((c) => valid.has(c)) };
}
