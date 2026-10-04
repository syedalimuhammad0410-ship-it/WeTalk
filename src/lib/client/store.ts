"use client";
import { useSyncExternalStore } from "react";
import type { ChatAction, ChatMessage, Clue, Investigation, InvestigationFocus, InvestigationMode, Note, RunStep } from "@/lib/types";
import type { PhaseId, RunEvent } from "@/lib/engine/runner";
import type { ResearchDelta } from "@/lib/engine/protocol";
import { api } from "./api";
import { mergeDelta } from "@/lib/engine/merge";
import { assess } from "@/lib/engine/reasoning";
import { buildBoard } from "@/lib/engine/graph";
import { nowIso, uid, yearOf } from "@/lib/util";

export type Tab = "result" | "image" | "board" | "map" | "candidates" | "compare" | "sources" | "timeline" | "queries" | "entities" | "notes";

export interface LogLine {
  at: string;
  text: string;
  level: "info" | "warn" | "error";
}

export interface WorkspaceState {
  inv: Investigation | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  phase: PhaseId | null;
  steps: RunStep[];
  logs: LogLine[];
  liveClues: Clue[];
  focus: { imageId: string; box?: { x: number; y: number; w: number; h: number }; label?: string } | null;
  compares: { candidateId: string; thumb: string; overall: string }[];
  /** live location fixes (AI geolocation hypotheses checked against the map) — drive the map/board animations */
  locates: { name: string; lat: number; lng: number; precision: string; confidence: number; confirmed: boolean; at: number }[];
  providers: { ai: boolean; aiName?: string | null; cloudVision: boolean; webKeyed: boolean } | null;
  animation: "full" | "reduced" | "off";
  tab: Tab;
  selectedCandidateId: string | null;
  cinematic: { open: boolean; replay: boolean; speed: "fast" | "detailed"; paused: boolean; runToken: number };
  saving: boolean;
  dirty: boolean;
  chatBusy: boolean;
  confirmReset: boolean;
}

const initial: WorkspaceState = {
  inv: null,
  loading: false,
  error: null,
  running: false,
  phase: null,
  steps: [],
  logs: [],
  liveClues: [],
  focus: null,
  compares: [],
  locates: [],
  providers: null,
  animation: "full",
  tab: "result",
  selectedCandidateId: null,
  cinematic: { open: false, replay: false, speed: "detailed", paused: false, runToken: 0 },
  saving: false,
  dirty: false,
  chatBusy: false,
  confirmReset: false,
};

let state: WorkspaceState = initial;
const listeners = new Set<() => void>();
function set(patch: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export const getState = () => state;
export function useWorkspace<T>(sel: (s: WorkspaceState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
    () => sel(initial),
  );
}

let abort: AbortController | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const ws = {
  set,
  async loadProviders() {
    if (state.providers) return;
    try {
      const r = await api.get<{ activeAi?: string | null; providers: { id: string; state: string }[] }>("/api/providers");
      const s = await api.get<{ prefs: { animation: WorkspaceState["animation"] } }>("/api/settings");
      const ready = (id: string) => r.providers.find((p) => p.id === id)?.state === "ready";
      const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      set({ providers: { ai: ready("anthropic") || ready("gemini"), aiName: r.activeAi, cloudVision: ready("google-cloud-vision"), webKeyed: ready("brave") || ready("tavily") }, animation: reduced ? "reduced" : s.prefs.animation });
    } catch {
      set({ providers: { ai: false, cloudVision: false, webKeyed: false } });
    }
  },
  async load(id: string) {
    if (state.inv?.id === id) return;
    abort?.abort();
    set({ ...initial, providers: state.providers, animation: state.animation, loading: true });
    try {
      const { investigation } = await api.load(id);
      set({ inv: investigation, loading: false, tab: investigation.conclusion ? "result" : "image" });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  unload() {
    abort?.abort();
    set({ ...initial, providers: state.providers, animation: state.animation });
  },
  /** Replace the investigation (optionally persist with debounce). */
  update(fn: (inv: Investigation) => Investigation, persist = true) {
    if (!state.inv) return;
    set({ inv: fn(state.inv), dirty: persist || state.dirty });
    if (persist) ws.saveSoon();
  },
  saveSoon(ms = 900) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void ws.saveNow(), ms);
  },
  async saveNow() {
    if (!state.inv || state.running) return;
    set({ saving: true });
    try {
      const { investigation } = await api.save(state.inv);
      set((s) => ({ saving: false, dirty: false, inv: s.inv ? { ...s.inv, updatedAt: investigation.updatedAt } : s.inv }));
    } catch (e) {
      set({ saving: false });
      ws.log(`Save failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  },
  log(text: string, level: LogLine["level"] = "info") {
    set((s) => ({ logs: [...s.logs.slice(-300), { at: nowIso(), text, level }] }));
  },
  async start(opts: { mode?: InvestigationMode; focus?: InvestigationFocus; cinematic?: boolean } = {}) {
    if (!state.inv || state.running) return;
    await ws.loadProviders();
    const { runInvestigation } = await import("@/lib/engine/runner");
    abort = new AbortController();
    const mode = opts.mode || state.inv.mode;
    const showCinema = opts.cinematic !== false && state.animation !== "off";
    set((s) => ({ running: true, phase: "ingest", steps: [], liveClues: [], compares: [], locates: [], focus: null, logs: [...s.logs, { at: nowIso(), text: `Investigation started (${mode} mode)`, level: "info" }], cinematic: { ...s.cinematic, open: showCinema, replay: false, paused: false, runToken: s.cinematic.runToken + 1 } }));
    const onEvent = (e: RunEvent) => {
      switch (e.type) {
        case "phase":
          set({ phase: e.phase });
          break;
        case "step":
          set((s) => {
            const i = s.steps.findIndex((x) => x.id === e.step.id);
            const steps = [...s.steps];
            if (i >= 0) steps[i] = e.step;
            else steps.push(e.step);
            return { steps };
          });
          break;
        case "state":
          set({ inv: e.inv });
          break;
        case "clues":
          set((s) => ({ liveClues: [...s.liveClues, ...e.clues] }));
          break;
        case "focus":
          set({ focus: e });
          break;
        case "compare":
          set((s) => ({ compares: [...s.compares, e] }));
          break;
        case "locate":
          set((s) => ({ locates: [...s.locates, { ...e, at: Date.now() }] }));
          break;
        case "log":
          ws.log(e.text, e.level || "info");
          break;
      }
    };
    try {
      const inv = await runInvestigation(state.inv, { mode, focus: opts.focus, signal: abort.signal, onEvent, providers: state.providers ? { ai: state.providers.ai, cloudVision: state.providers.cloudVision } : undefined });
      set({ inv, running: false, phase: "result", dirty: false });
      ws.log("Investigation complete.");
    } catch (e) {
      set({ running: false });
      ws.log(e instanceof Error ? e.message : String(e), "error");
    }
  },
  cancel() {
    abort?.abort();
  },
  applyDelta(d: Partial<ResearchDelta>) {
    ws.update((inv) => {
      const merged = mergeDelta(inv, d);
      const assessed = merged.candidates.length ? assess(merged) : merged;
      return { ...assessed, boards: [buildBoard(assessed, assessed.boards[0]), ...assessed.boards.slice(1)] };
    });
  },
  reassess() {
    ws.update((inv) => {
      const a = assess(inv);
      return { ...a, boards: [buildBoard(a, a.boards[0]), ...a.boards.slice(1)] };
    });
  },
  async search(kind: string, query: string, opts: { officialOnly?: boolean; userAdded?: boolean; branch?: string } = {}) {
    ws.log(`Searching ${kind}: “${query}”`);
    try {
      if (kind === "maps") {
        const r = await api.post<{ provider: string; status: string; items: { name: string; displayName: string; lat: number; lng: number; kind: string; url: string }[]; error?: string }>("/api/search/maps", { op: "geocode", q: query });
        const qid = uid("q");
        ws.applyDelta({
          queries: [{ id: qid, branch: opts.branch || "manual", text: query, kind: "maps", provider: r.provider, status: r.status as "ok", resultCount: r.items.length, error: r.error, createdAt: nowIso(), userAdded: opts.userAdded }],
          results: r.items.map((p) => ({ id: uid("r"), queryId: qid, title: p.name, url: p.url, snippet: p.displayName })),
          sources: [],
          locations: r.items.slice(0, 5).map((p) => ({ id: uid("loc"), name: p.name, address: p.displayName, lat: p.lat, lng: p.lng, kind: p.kind, sourceIds: [], userSelected: true })),
        });
        set({ tab: "map" });
        return;
      }
      const d = await api.post<ResearchDelta>("/api/search", { kind, query, branch: opts.branch || "manual", officialOnly: opts.officialOnly, userAdded: opts.userAdded });
      ws.applyDelta(d);
      const q = d.queries[0];
      ws.log(`${q?.provider}: ${q?.status}${q?.error ? ` — ${q.error}` : ""} (${d.results.length} results)`, q?.status === "error" ? "warn" : "info");
    } catch (e) {
      ws.log(`Search failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  },
  addNote(text: string) {
    const note: Note = { id: uid("note"), text: text.slice(0, 2000), createdAt: nowIso(), tags: [], yearHint: yearOf(text) };
    ws.update((inv) => assessIf({ ...inv, notes: [...inv.notes, note] }));
  },
  removeNote(id: string) {
    ws.update((inv) => assessIf({ ...inv, notes: inv.notes.filter((n) => n.id !== id) }));
  },
  ignoreClue(match: string) {
    const m = match.toLowerCase();
    ws.update((inv) => assessIf({ ...inv, clues: inv.clues.map((c) => (c.value.toLowerCase().includes(m) || c.type === m ? { ...c, ignored: true } : c)) }));
  },
  toggleClue(id: string) {
    ws.update((inv) => assessIf({ ...inv, clues: inv.clues.map((c) => (c.id === id ? { ...c, ignored: !c.ignored } : c)) }));
  },
  resetInvestigation() {
    abort?.abort();
    ws.update((inv) => ({ ...inv, status: "draft", clues: [], entities: [], candidates: [], locations: [], evidence: [], sources: [], queries: [], results: [], timeline: [], contradictions: [], chat: [], notes: [], boards: [], conclusion: undefined, focus: undefined, regions: [] }));
    set({ steps: [], logs: [], liveClues: [], compares: [], locates: [], phase: null, tab: "image", confirmReset: false, cinematic: { ...state.cinematic, open: false } });
    ws.log("Investigation reset. Images were kept; saved investigations were not deleted.");
  },
  async chat(message: string) {
    if (!state.inv || state.chatBusy) return;
    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: message, createdAt: nowIso() };
    ws.update((inv) => ({ ...inv, chat: [...inv.chat, userMsg] }), false);
    set({ chatBusy: true });
    try {
      if (state.dirty || state.saving) await ws.saveNow();
      else await api.save(state.inv!);
      const r = await api.post<{ reply: string; actions: ChatAction[]; delta?: ResearchDelta; sourceIds?: string[]; engine: string; warning?: string }>("/api/chat", { investigationId: state.inv!.id, message });
      if (r.delta && (r.delta.sources.length || r.delta.queries.length)) ws.applyDelta(r.delta);
      const msg: ChatMessage = { id: uid("msg"), role: "assistant", content: r.reply + (r.warning ? `\n\n_${r.warning}_` : ""), createdAt: nowIso(), actions: r.actions, sourceIds: r.sourceIds, engine: r.engine };
      ws.update((inv) => ({ ...inv, chat: [...inv.chat, msg] }));
      // auto-execute non-destructive actions; reset requires confirmation
      for (const a of r.actions || []) {
        if (a.type === "reset") set({ confirmReset: true });
        else await ws.runAction(a, msg.id);
      }
    } catch (e) {
      const msg: ChatMessage = { id: uid("msg"), role: "assistant", content: `Sorry — the assistant failed: ${e instanceof Error ? e.message : e}`, createdAt: nowIso(), engine: "error" };
      ws.update((inv) => ({ ...inv, chat: [...inv.chat, msg] }));
    } finally {
      set({ chatBusy: false });
    }
  },
  async runAction(a: ChatAction, messageId?: string) {
    const p = (a.payload || {}) as Record<string, unknown>;
    const mark = (status: ChatAction["status"]) =>
      messageId && ws.update((inv) => ({ ...inv, chat: inv.chat.map((m) => (m.id === messageId ? { ...m, actions: m.actions?.map((x) => (x === a || (x.type === a.type && x.label === a.label) ? { ...x, status } : x)) } : m)) }), false);
    try {
      switch (a.type) {
        case "show_tab":
          set({ tab: (p.tab as Tab) || "result", selectedCandidateId: (p.candidateId as string) || state.selectedCandidateId });
          break;
        case "search":
        case "map_search":
          await ws.search(a.type === "map_search" ? "maps" : String(p.kind || "web"), String(p.query || ""), { officialOnly: Boolean(p.officialOnly), branch: "chat" });
          break;
        case "rerun":
          void ws.start({ focus: p.focus as InvestigationFocus | undefined, mode: p.mode as InvestigationMode | undefined });
          break;
        case "ignore_clue":
          ws.ignoreClue(String(p.match || ""));
          break;
        case "add_note":
          ws.addNote(String(p.text || ""));
          break;
        case "export":
          window.dispatchEvent(new CustomEvent("trace:export"));
          break;
        case "reset":
          set({ confirmReset: true });
          return;
        default:
          break;
      }
      mark("done");
    } catch {
      mark("error");
    }
  },
};

function assessIf(inv: Investigation) {
  if (!inv.candidates.length) return inv;
  const a = assess(inv);
  return { ...a, boards: [buildBoard(a, a.boards[0]), ...a.boards.slice(1)] };
}
