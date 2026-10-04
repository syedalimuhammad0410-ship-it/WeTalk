"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { BookMarked, Download, Film, MessageSquare, Pencil, Play, RotateCcw, Square, X } from "lucide-react";
import { useWorkspace, ws, type Tab } from "@/lib/client/store";
import { Button, Dialog, Empty, Spinner, cn } from "@/components/ui";
import { MODES } from "@/lib/modes";
import type { InvestigationMode } from "@/lib/types";
import { StatusBar } from "./StatusBar";
import { ChatPanel } from "./ChatPanel";
import { ResultView } from "./ResultView";
import { ImageTab } from "./ImageTab";
import { CandidatesView } from "./CandidatesView";
import { SourcesView } from "./SourcesView";
import { TimelineView } from "./TimelineView";
import { QueriesView } from "./QueriesView";
import { EntitiesView } from "./EntitiesView";
import { NotesView } from "./NotesView";
import { ExportDialog } from "./ExportDialog";
import { Cinematic } from "./Cinematic";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), { ssr: false, loading: () => <div className="grid h-full place-items-center"><Spinner /></div> });
const EvidenceBoard = dynamic(() => import("./EvidenceBoard").then((m) => m.EvidenceBoard), { ssr: false, loading: () => <div className="grid h-full place-items-center"><Spinner /></div> });
const CompareView = dynamic(() => import("./CompareView").then((m) => m.CompareView), { ssr: false });

const TABS: { id: Tab; label: string }[] = [
  { id: "result", label: "Result" },
  { id: "image", label: "Images & clues" },
  { id: "board", label: "Evidence board" },
  { id: "map", label: "Map" },
  { id: "candidates", label: "Candidates" },
  { id: "compare", label: "Compare" },
  { id: "sources", label: "Sources" },
  { id: "timeline", label: "Timeline" },
  { id: "queries", label: "Queries" },
  { id: "entities", label: "Entities" },
  { id: "notes", label: "Notes" },
];

function WorkspaceInner({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const inv = useWorkspace((s) => s.inv);
  const loading = useWorkspace((s) => s.loading);
  const error = useWorkspace((s) => s.error);
  const tab = useWorkspace((s) => s.tab);
  const running = useWorkspace((s) => s.running);
  const cinematicOpen = useWorkspace((s) => s.cinematic.open);
  const confirmReset = useWorkspace((s) => s.confirmReset);
  const saving = useWorkspace((s) => s.saving);
  const dirty = useWorkspace((s) => s.dirty);
  const [chatOpen, setChatOpen] = useState(true);
  const [mobileChat, setMobileChat] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const autoRan = useRef(false);

  useEffect(() => {
    void ws.loadProviders();
    void ws.load(id);
  }, [id]);
  useEffect(() => {
    if (inv?.id === id && params.get("run") === "1" && !autoRan.current && !running) {
      autoRan.current = true;
      router.replace(`/app/i/${id}`);
      void ws.start({ mode: inv.mode });
    }
  }, [inv?.id, id, params, router, running, inv?.mode]);
  useEffect(() => {
    const onExport = () => setExportOpen(true);
    window.addEventListener("trace:export", onExport);
    return () => window.removeEventListener("trace:export", onExport);
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (running || dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, dirty]);

  if (error)
    return (
      <Empty title="Could not open this investigation">
        {error}{" "}
        <a href="/app/investigations" className="text-cyan">
          Back to investigations
        </a>
      </Empty>
    );
  if (loading || !inv || inv.id !== id)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner className="size-6" />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2.5">
          <div className="min-w-0 basis-full sm:min-w-[260px] sm:flex-1 sm:basis-[260px]">
            {editTitle ? (
              <input
                autoFocus
                defaultValue={inv.title}
                aria-label="Investigation title"
                onBlur={(e) => {
                  setEditTitle(false);
                  const t = e.target.value.trim();
                  if (t && t !== inv.title) ws.update((i) => ({ ...i, title: t.slice(0, 200) }));
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="w-full rounded border border-line-strong bg-black/30 px-2 py-1 text-[14px]"
              />
            ) : (
              <button onClick={() => setEditTitle(true)} className="group flex max-w-full items-center gap-2 text-left">
                <h1 className="truncate text-[14.5px] font-semibold">{inv.title}</h1>
                <Pencil className="size-3 shrink-0 text-mute opacity-0 group-hover:opacity-100" />
              </button>
            )}
            <div className="label-mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap !text-[9.5px] text-mute">
              {inv.demo && <span className="whitespace-nowrap rounded-[2px] bg-warn/15 px-1 text-warn">DEMO · public sample data</span>}
              <span>{inv.images.length} image{inv.images.length !== 1 && "s"}</span>
              <span>·</span>
              <span>{running ? "running" : inv.status}</span>
              <span>·</span>
              <span>{saving ? "saving…" : dirty ? "unsaved" : "saved"}</span>
            </div>
          </div>
          <select aria-label="Investigation mode" value={inv.mode} disabled={running} onChange={(e) => ws.update((i) => ({ ...i, mode: e.target.value as InvestigationMode }))} className="h-8 rounded-[5px] border border-line-strong bg-black/30 px-2 text-[12.5px]">
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {running ? (
            <Button size="sm" variant="danger" onClick={() => ws.cancel()}>
              <Square className="size-3" /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => ws.start({ mode: inv.mode })} disabled={!inv.images.length}>
              <Play className="size-3" /> {inv.conclusion ? "Re-run" : "Start investigation"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => ws.set((s) => ({ cinematic: { ...s.cinematic, open: true, replay: !running, paused: false, runToken: s.cinematic.runToken + 1 } }))} disabled={!inv.images.length} title="Replay the cinematic investigation">
            <Film className="size-3.5" /> {running ? "Watch" : "Replay"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => ws.set({ tab: "sources" })} className="border-cyan/40 text-cyan">
            <BookMarked className="size-3.5" /> SOURCES <span className="text-mute">{inv.sources.length}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setExportOpen(true)}>
            <Download className="size-3.5" /> Export
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ws.set({ confirmReset: true })} disabled={running} title="Reset investigation">
            <RotateCcw className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="hidden lg:inline-flex" onClick={() => setChatOpen((o) => !o)} aria-pressed={chatOpen} title="Toggle TRACE AI">
            <MessageSquare className="size-3.5" />
          </Button>
        </div>
        {/* tabs */}
        <div role="tablist" aria-label="Investigation views" className="flex gap-0.5 overflow-x-auto border-b border-line bg-panel px-2">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => ws.set({ tab: t.id })} className={cn("relative whitespace-nowrap px-3 py-2.5 text-[12.5px] transition-colors", tab === t.id ? "text-fg" : "text-mute hover:text-dim")}>
              {t.label}
              {t.id === "sources" && inv.sources.length > 0 && <span className="ml-1 text-mute">{inv.sources.length}</span>}
              {t.id === "candidates" && inv.candidates.length > 0 && <span className="ml-1 text-mute">{inv.candidates.length}</span>}
              {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-[2px] bg-cyan" />}
            </button>
          ))}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className={cn("absolute inset-0", tab === "board" || tab === "map" ? "" : "overflow-y-auto")}>
            {tab === "result" && <ResultView />}
            {tab === "image" && <ImageTab />}
            {tab === "board" && <EvidenceBoard />}
            {tab === "map" && <MapView />}
            {tab === "candidates" && <CandidatesView />}
            {tab === "compare" && <CompareView />}
            {tab === "sources" && <SourcesView />}
            {tab === "timeline" && <TimelineView />}
            {tab === "queries" && <QueriesView />}
            {tab === "entities" && <EntitiesView />}
            {tab === "notes" && <NotesView />}
          </div>
        </div>
        <StatusBar />
      </div>
      <aside className={cn("hidden w-[360px] shrink-0 border-l border-line bg-panel", chatOpen && "lg:flex")}>
        <ChatPanel />
      </aside>
      {/* mobile chat */}
      <button onClick={() => setMobileChat(true)} className="fixed bottom-14 right-4 z-30 grid size-12 place-items-center rounded-full border border-cyan/40 bg-panel text-cyan shadow-xl lg:hidden" aria-label="Open TRACE AI">
        <MessageSquare className="size-5" />
      </button>
      {mobileChat && (
        <div className="fixed inset-0 z-50 flex flex-col bg-panel lg:hidden">
          <button onClick={() => setMobileChat(false)} className="absolute right-3 top-3 z-10 rounded p-1.5 text-dim" aria-label="Close TRACE AI">
            <X className="size-5" />
          </button>
          <ChatPanel />
        </div>
      )}
      {cinematicOpen && <Cinematic />}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <Dialog open={confirmReset} onClose={() => ws.set({ confirmReset: false })} title="Reset current investigation?">
        <p className="text-[13.5px] leading-relaxed text-dim">This clears the active investigation state: clues, candidates, evidence, sources, chat and notes. Uploaded images are kept. Saved investigations are not deleted unless you delete them explicitly.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => ws.set({ confirmReset: false })}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => ws.resetInvestigation()}>
            Reset
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function Workspace({ id }: { id: string }) {
  return (
    <Suspense>
      <WorkspaceInner id={id} />
    </Suspense>
  );
}
