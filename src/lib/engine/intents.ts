// Deterministic investigation assistant. Always available (no API key needed);
// answers strictly from investigation state and maps commands to app actions.
// When an AI provider is configured, the LLM agent is used instead and can call the
// same actions as tools.
import type { ChatAction, Investigation } from "@/lib/types";
import { compact, norm } from "@/lib/util";

export interface IntentAnswer {
  reply: string;
  actions: ChatAction[];
  sourceIds?: string[];
}

const ord: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, one: 1, two: 2, three: 3, four: 4, five: 5 };

export function candidateRef(inv: Investigation, text: string) {
  const m = text.match(/(?:candidate|option|#)\s*#?\s*(\d+)/i) || text.match(/\b(first|second|third|fourth|fifth|sixth)\b\s+(?:candidate|option|one)/i);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ord[m[1].toLowerCase()];
    return inv.candidates[n - 1];
  }
  const t = compact(text);
  return inv.candidates.find((c) => c.names.some((n) => compact(n.name).length > 4 && t.includes(compact(n.name))));
}

const list = (xs: string[], n = 6) => xs.slice(0, n).map((x) => `• ${x}`).join("\n");

export function answer(inv: Investigation, message: string): IntentAnswer {
  const m = norm(message);
  const lead = inv.candidates.find((c) => c.id === inv.conclusion?.candidateId);
  const has = (...w: string[]) => w.some((x) => new RegExp(`\\b${x}\\b`).test(m));

  // ---- commands
  if (has("reset", "start over", "clear everything", "clear all")) {
    return { reply: "Reset the current investigation? Saved investigations are not deleted — only the active state (clues, candidates, evidence, chat) is cleared.", actions: [{ type: "reset", label: "Reset investigation", status: "proposed" }] };
  }
  if (has("enhance")) return { reply: "Opening image enhancement. Enhancement can clarify existing detail but cannot recover information that was never captured.", actions: [{ type: "show_tab", label: "Open enhancement", payload: { tab: "image", panel: "enhance" } }] };
  const focusMatch = m.match(/(?:focus|look closer|look) (?:only )?(?:on|at) (?:the )?(.+)/);
  if (focusMatch) {
    const what = focusMatch[1];
    const types = /logo/.test(what) ? ["logo"] : /sign|text|name/.test(what) ? ["text", "logo"] : /build|architect/.test(what) ? ["architecture", "scene"] : /court|field|sport/.test(what) ? ["sport", "scene", "logo", "text"] : undefined;
    return {
      reply: `Re-running the analysis focused on ${what}. Other clues will be kept but not used for scoring.`,
      actions: [{ type: "rerun", label: `Focus on ${what}`, payload: { focus: { clueTypes: types, instruction: `Focus on ${what}` } } }],
    };
  }
  const ignoreMatch = m.match(/ignore (?:the )?(.+?)(?: clue)?$/);
  if (ignoreMatch) return { reply: `Ignoring clues matching “${ignoreMatch[1]}” and re-assessing the candidates.`, actions: [{ type: "ignore_clue", label: `Ignore “${ignoreMatch[1]}”`, payload: { match: ignoreMatch[1] } }] };
  if (has("analy[sz]e this", "analy[sz]e again", "run again", "rerun", "re run")) {
    const what = m.match(/analy[sz]e (?:the )?(building|sign|logo|court)/)?.[1];
    return { reply: what ? `Re-analysing with focus on the ${what}.` : "Re-running the investigation.", actions: [{ type: "rerun", label: "Re-run investigation", payload: what ? { focus: { instruction: `Analyse the ${what}` } } : {} }] };
  }
  const searchKind = /video/.test(m) ? "videos" : /news/.test(m) ? "news" : /histor/.test(m) ? "history" : /(image|photo|picture)s?/.test(m) && /search|find|more/.test(m) ? "images" : /(sport|game) record/.test(m) ? "web" : /map/.test(m) && /search/.test(m) ? "maps" : /business/.test(m) ? "maps" : /search|find|look up|lookup/.test(m) ? "web" : null;
  if (searchKind && /search|find|look|check/.test(m)) {
    const subject = lead?.name || inv.entities[0]?.name || inv.clues.find((c) => c.type === "text")?.value || "";
    const official = /official/.test(m);
    const qText = message.replace(/^(please )?(search|find|look up|look for|check)( for)?( more)?/i, "").replace(/\b(official sources|videos?|news|historical( photos)?|images|photos|maps?|businesses|sports records)\b/gi, "").trim();
    const query = (qText.length > 3 ? qText : subject + (searchKind === "history" ? " history" : /building/.test(m) ? " building" : "")).trim();
    if (!query) return { reply: "There's nothing specific to search for yet — upload an image or tell me what to search.", actions: [] };
    if (/still exist/.test(m) && lead) return { reply: `Checking whether ${lead.name} still exists: searching recent news and records.`, actions: [{ type: "search", label: `News: ${lead.name}`, payload: { kind: "news", query: lead.name } }, { type: "search", label: `Web: ${lead.name} demolished closed`, payload: { kind: "web", query: `${lead.name} demolished OR closed OR renamed` } }] };
    return {
      reply: `Running a ${searchKind} search for “${query}”${official ? " restricted to official sources" : ""}. Results will appear in Sources and Queries.`,
      actions: [{ type: searchKind === "maps" ? "map_search" : "search", label: `${searchKind}: ${query}`, payload: { kind: searchKind, query, officialOnly: official } }],
    };
  }
  if (has("compare")) {
    const c = candidateRef(inv, message) || lead;
    if (/second image|image 2|other image/.test(m)) return { reply: "Opening the multi-image comparison.", actions: [{ type: "show_tab", label: "Images", payload: { tab: "image" } }] };
    return { reply: c ? `Opening the visual comparison for ${c.name}.` : "Opening candidate comparison.", actions: [{ type: "show_tab", label: "Compare", payload: { tab: "compare", candidateId: c?.id } }] };
  }
  if (has("show map", "map")) return { reply: "Showing the map with all candidate locations.", actions: [{ type: "show_tab", label: "Map", payload: { tab: "map" } }] };
  if (has("timeline")) {
    const tl = [...inv.timeline].sort((a, b) => a.year - b.year);
    return { reply: tl.length ? `Timeline (${tl.length} events):\n${list(tl.map((t) => `${t.year} — ${t.label}`), 10)}` : "No dated events yet.", actions: [{ type: "show_tab", label: "Timeline", payload: { tab: "timeline" } }], sourceIds: tl.flatMap((t) => t.sourceIds).slice(0, 10) };
  }
  if (has("export", "report", "pdf")) return { reply: "Opening export options (PDF report, PNG board, JSON, CSV, Markdown, text).", actions: [{ type: "export", label: "Export" }] };
  if (has("note")) {
    const t = message.replace(/^.*?note[:\s]+/i, "").trim();
    if (t.length > 2) return { reply: `Added your note. It's treated as user-provided information, separate from verified evidence.`, actions: [{ type: "add_note", label: "Add note", payload: { text: t } }] };
  }

  // ---- questions
  if (!inv.clues.length && !inv.candidates.length) return { reply: "No investigation has run yet. Upload an image (or try a demo) and I'll extract clues, search public sources and build the case.", actions: [] };

  if (has("source", "sources", "citations")) {
    const used = inv.sources.filter((s) => s.usedInReasoning);
    return { reply: `${inv.sources.length} sources collected, ${used.length} used in reasoning.\n${list(used.map((s) => `${s.title} — ${s.publisher}`))}`, actions: [{ type: "show_tab", label: "Sources", payload: { tab: "sources" } }], sourceIds: used.map((s) => s.id).slice(0, 12) };
  }
  if (has("evidence")) {
    const c = candidateRef(inv, message) || lead;
    const ev = inv.evidence.filter((e) => !c || e.candidateId === c.id);
    const fmt = (e: (typeof ev)[number]) => `[${e.kind.toUpperCase()} · ${e.polarity}] ${e.statement}`;
    return { reply: c ? `Evidence for ${c.name}:\n${list(ev.map(fmt), 10)}` : list(ev.map(fmt), 10), actions: [{ type: "show_tab", label: "Evidence board", payload: { tab: "board" } }], sourceIds: ev.flatMap((e) => e.sourceIds).slice(0, 12) };
  }
  if (has("reject", "rejected")) {
    const c = candidateRef(inv, message) || inv.candidates.find((x) => x.status === "rejected");
    if (!c) return { reply: "No candidates have been rejected so far.", actions: [] };
    return { reply: c.status === "rejected" ? `${c.name} was rejected: ${c.rejectionReason}\n${list(c.against)}` : `${c.name} was not rejected; it's ranked lower because:\n${list(c.against.length ? c.against : c.confidenceReasons)}`, actions: [], sourceIds: c.sourceIds };
  }
  if (has("alternative", "alternatives", "other location", "other locations", "could this be")) {
    const alts = inv.candidates.filter((c) => c.id !== lead?.id);
    return { reply: alts.length ? `Other possibilities:\n${list(alts.map((c) => `#${inv.candidates.indexOf(c) + 1} ${c.name}${c.city ? ` (${c.city})` : ""} — ${c.status === "rejected" ? "rejected" : `${c.confidence} confidence`}`), 8)}` : "No alternative candidates were generated.", actions: [{ type: "show_tab", label: "Candidates", payload: { tab: "candidates" } }] };
  }
  if (has("missing", "uncertain", "unknown", "gaps")) {
    const gaps = [...(inv.conclusion?.uncertainties || []), ...(inv.conclusion?.nextSteps || [])];
    return { reply: `What's still uncertain or missing:\n${list(gaps, 8)}`, actions: [] };
  }
  const refC = candidateRef(inv, message);
  if (refC && !has("why")) {
    return {
      reply: `#${inv.candidates.indexOf(refC) + 1} ${refC.name}${refC.city ? `, ${refC.city}` : ""} — ${refC.status}, ${refC.confidence} confidence.\nFor:\n${list(refC.why, 4)}\nAgainst:\n${list(refC.against.length ? refC.against : ["Nothing recorded"], 4)}`,
      actions: [{ type: "show_tab", label: "Open candidate", payload: { tab: "candidates", candidateId: refC.id } }],
      sourceIds: refC.sourceIds,
    };
  }
  if (has("why", "explain", "how")) {
    const c = refC || lead;
    if (!c) return { reply: inv.conclusion?.explanation || "There's no leading candidate yet.", actions: [] };
    return { reply: `${inv.conclusion?.candidateId === c.id ? inv.conclusion.explanation + "\n\n" : ""}Supporting:\n${list(c.why)}\n${c.against.length ? `Limiting:\n${list(c.against)}` : ""}`, actions: [], sourceIds: c.sourceIds };
  }
  if (has("what did you find", "find", "result", "summary", "status", "conclusion")) {
    return {
      reply: `${inv.conclusion?.headline || "Investigation in progress."} (${inv.conclusion?.confidence || "—"} confidence)\n${inv.clues.length} clues · ${inv.entities.length} entities · ${inv.candidates.length} candidates · ${inv.sources.length} sources · ${inv.contradictions.length} contradictions.\n${inv.conclusion?.explanation || ""}`,
      actions: [{ type: "show_tab", label: "Result", payload: { tab: "result" } }],
      sourceIds: lead?.sourceIds,
    };
  }
  return {
    reply: "I can answer from the current investigation or run actions. Try: “What did you find?”, “Why this location?”, “Show the evidence”, “What other locations could this be?”, “Why did you reject candidate #2?”, “Search news about this venue”, “Focus on the logo”, “Create a timeline”, or “Reset”. (Configure an AI provider in Settings for open-ended conversation.)",
    actions: [],
  };
}
