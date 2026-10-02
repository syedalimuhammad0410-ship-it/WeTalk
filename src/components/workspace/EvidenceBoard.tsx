"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { BookMarked, Clock3, Copy, Download, FileText, Globe2, ImageIcon, LayoutGrid, MapPin, Network, Pin, Plus, Quote, Search, StickyNote, Target, Trash2, Users } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { buildBoard, type ArrangeMode } from "@/lib/engine/graph";
import { Button, cn } from "@/components/ui";
import type { Board, BoardEdge, BoardNode, BoardNodeData } from "@/lib/types";
import { nowIso, uid } from "@/lib/util";

const ICON: Record<string, typeof Network> = { image: ImageIcon, clue: Quote, entity: Users, candidate: Target, location: MapPin, source: BookMarked, query: Search, timeline: Clock3, note: StickyNote, conclusion: Globe2, map: MapPin, video: FileText };
const ACCENT: Record<string, string> = { image: "border-white/25", clue: "border-signal/50", entity: "border-violet-400/50", candidate: "border-cyan/50", location: "border-ok/50", source: "border-white/20", timeline: "border-warn/40", note: "border-warn/50", conclusion: "border-signal" };
const TAGS = ["#ff7a45", "#59d4e8", "#57d68d", "#f2b84b", "#ff4f5e", "#a78bfa"];

const EvidenceNode = memo(function EvidenceNode({ data, selected }: NodeProps<Node<BoardNodeData>>) {
  const Icon = ICON[data.kind] || Network;
  const tag = typeof data.userColor === "string" ? (data.userColor as string) : undefined;
  return (
    <div className={cn("w-[230px] rounded-[5px] border bg-panel/95 shadow-xl backdrop-blur transition-shadow", ACCENT[data.kind] || "border-line", selected && "ring-2 ring-cyan/60", data.color === "muted" && "opacity-50", data.kind === "conclusion" && "bg-signal/10")} style={tag ? { borderColor: tag, boxShadow: `0 0 0 1px ${tag}55` } : undefined}>
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-white/40" />
      {data.thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.thumb} alt="" className="h-24 w-full rounded-t-[4px] object-cover" draggable={false} />
      )}
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <Icon className="size-3 shrink-0 text-mute" />
          <span className="label-mono truncate !text-[8.5px] text-mute">{data.kind}</span>
          {data.pinned && <Pin className="ml-auto size-3 text-signal" />}
        </div>
        <div className="mt-1 line-clamp-3 text-[12.5px] font-medium leading-snug">{data.title}</div>
        {data.subtitle && <div className="mt-0.5 line-clamp-2 text-[11px] text-mute">{data.subtitle}</div>}
        {data.note && <div className="mt-1.5 rounded-[3px] bg-warn/10 px-1.5 py-1 text-[11px] text-warn">{data.note}</div>}
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-cyan/70" />
    </div>
  );
});

const nodeTypes = { evidence: EvidenceNode, "note-card": EvidenceNode };

function toFlow(b: Board, hiddenKinds: Set<string>): { nodes: Node<BoardNodeData>[]; edges: Edge[] } {
  return {
    nodes: b.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data, hidden: hiddenKinds.has(n.data.kind) })),
    edges: b.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: !e.manual,
      style: { stroke: e.kind === "contradicts" ? "#ff4f5e" : e.kind === "supports" ? "rgba(89,212,232,0.55)" : e.manual ? "#f2b84b" : "rgba(255,255,255,0.22)", strokeDasharray: e.kind === "contradicts" ? "4 4" : undefined },
      data: { manual: e.manual, kind: e.kind },
    })),
  };
}

function Inner() {
  const inv = useWorkspace((s) => s.inv)!;
  const running = useWorkspace((s) => s.running);
  const [boardIdx, setBoardIdx] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const board = inv.boards[boardIdx] || inv.boards[0];
  const [nodes, setNodes] = useState<Node<BoardNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

  // initialise / grow live
  useEffect(() => {
    if (!inv.boards.length && (inv.clues.length || inv.images.length)) {
      ws.update((i) => ({ ...i, boards: [buildBoard(i)] }), !running);
      return;
    }
    if (board) {
      const f = toFlow(board, hidden);
      setNodes(f.nodes);
      setEdges(f.edges);
    }
  }, [board, hidden, inv.boards.length, inv.clues.length, inv.images.length, running]);

  // live growth while the investigation runs
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const cur = useWorkspaceSnapshot();
      if (cur) ws.update((i) => ({ ...i, boards: [buildBoard(i, i.boards[0]), ...i.boards.slice(1)] }), false);
    }, 2500);
    return () => clearInterval(t);
  }, [running]);

  const persist = useCallback(
    (ns: Node<BoardNodeData>[], es: Edge[]) => {
      if (!board) return;
      const nb: Board = {
        ...board,
        nodes: ns.map((n) => ({ id: n.id, type: n.type || "evidence", position: n.position, data: n.data })) as BoardNode[],
        edges: es.map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === "string" ? e.label : undefined, manual: Boolean((e.data as { manual?: boolean })?.manual), kind: (e.data as { kind?: BoardEdge["kind"] })?.kind })),
        updatedAt: nowIso(),
      };
      ws.update((i) => ({ ...i, boards: i.boards.map((b, k) => (k === boardIdx ? nb : b)) }));
    },
    [board, boardIdx],
  );

  const onNodesChange = useCallback(
    (ch: NodeChange<Node<BoardNodeData>>[]) => {
      setNodes((ns) => {
        let next = applyNodeChanges(ch, ns);
        const moved = ch.some((c) => c.type === "position" && c.dragging === false);
        const removed = ch.some((c) => c.type === "remove");
        if (moved) next = next.map((n) => (ch.some((c) => c.type === "position" && c.id === n.id) ? { ...n, data: { ...n.data, moved: true } } : n));
        if (moved || removed) persist(next, edges);
        return next;
      });
    },
    [edges, persist],
  );
  const onEdgesChange = useCallback(
    (ch: EdgeChange[]) => {
      setEdges((es) => {
        const next = applyEdgeChanges(ch, es);
        if (ch.some((c) => c.type === "remove")) persist(nodes, next);
        return next;
      });
    },
    [nodes, persist],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const label = window.prompt("Label this connection (e.g. matches, located at, contradicts)", "relates to") || "relates to";
      setEdges((es) => {
        const next = addEdge({ ...c, id: `m:${uid()}`, label, style: { stroke: "#f2b84b" }, data: { manual: true, kind: /contradict/i.test(label) ? "contradicts" : "relates" } }, es);
        persist(nodes, next);
        return next;
      });
    },
    [nodes, persist],
  );

  const selected = nodes.find((n) => n.id === sel);
  const mutateSelected = (fn: (d: BoardNodeData) => BoardNodeData) => {
    if (!selected) return;
    const next = nodes.map((n) => (n.id === selected.id ? { ...n, data: fn(n.data) } : n));
    setNodes(next);
    persist(next, edges);
  };

  const arrange = (mode: ArrangeMode) => {
    ws.update((i) => ({ ...i, boards: i.boards.map((b, k) => (k === boardIdx ? buildBoard(i, { ...b, nodes: b.nodes.map((n) => ({ ...n, data: { ...n.data, moved: false } })) }, mode) : b)) }));
    setTimeout(() => rf.fitView({ padding: 0.15, duration: 600 }), 80);
  };
  const addNote = () => {
    const text = window.prompt("Note");
    if (!text) return;
    const center = rf.screenToFlowPosition({ x: (wrap.current?.clientWidth || 800) / 2, y: (wrap.current?.clientHeight || 600) / 2 });
    const n: Node<BoardNodeData> = { id: `manual:${uid()}`, type: "note-card", position: center, data: { kind: "note", title: text.slice(0, 200), subtitle: "board note (user-provided)" } };
    const next = [...nodes, n];
    setNodes(next);
    persist(next, edges);
  };
  const newBoard = () => {
    const name = window.prompt("Board name", `Board ${inv.boards.length + 1}`);
    if (!name) return;
    ws.update((i) => ({ ...i, boards: [...i.boards, { ...buildBoard(i), id: uid("board"), name }] }));
    setBoardIdx(inv.boards.length);
  };
  const exportPng = async () => {
    const el = wrap.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el) return;
    const { toPng } = await import("html-to-image");
    rf.fitView({ padding: 0.1 });
    await new Promise((r) => setTimeout(r, 300));
    const url = await toPng(wrap.current!.querySelector<HTMLElement>(".react-flow")!, { backgroundColor: "#08090b", pixelRatio: 2, filter: (n) => !(n as HTMLElement).classList?.contains("react-flow__controls") && !(n as HTMLElement).classList?.contains("react-flow__minimap") });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${inv.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-evidence-board.png`;
    a.click();
  };
  const kinds = useMemo(() => Array.from(new Set(board?.nodes.map((n) => n.data.kind) || [])), [board]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-panel px-3 py-1.5">
        <select aria-label="Board" value={boardIdx} onChange={(e) => setBoardIdx(Number(e.target.value))} className="h-7 rounded-[5px] border border-line-strong bg-black/30 px-2 text-[12px]">
          {inv.boards.map((b, i) => (
            <option key={b.id} value={i}>
              {b.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={newBoard}>
          <Plus className="size-3.5" /> Board
        </Button>
        <span className="mx-1 h-4 w-px bg-line" />
        <Button size="sm" variant="ghost" onClick={() => arrange("auto")}>
          <LayoutGrid className="size-3.5" /> Auto Arrange
        </Button>
        <Button size="sm" variant="ghost" onClick={() => arrange("location")}>
          Focus on Location
        </Button>
        <Button size="sm" variant="ghost" onClick={() => arrange("sources")}>
          Focus on Sources
        </Button>
        <Button size="sm" variant="ghost" onClick={() => arrange("timeline")}>
          Focus on Timeline
        </Button>
        <span className="mx-1 h-4 w-px bg-line" />
        <Button size="sm" variant="ghost" onClick={addNote}>
          <StickyNote className="size-3.5" /> Note
        </Button>
        <Button size="sm" variant="ghost" onClick={exportPng}>
          <Download className="size-3.5" /> PNG
        </Button>
        <div className="ml-auto flex flex-wrap gap-1">
          {kinds.map((k) => (
            <button key={k} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className={cn("label-mono rounded-[3px] border px-1.5 py-0.5 !text-[9px]", hidden.has(k) ? "border-line text-mute line-through" : "border-line-strong text-dim")} title={hidden.has(k) ? `Expand ${k} group` : `Collapse ${k} group`}>
              {k}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrap} className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSel(n.id)}
          onPaneClick={() => setSel(null)}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.15}
          maxZoom={2.2}
          deleteKeyCode={["Delete", "Backspace"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,0.07)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => ((n.data as BoardNodeData).kind === "candidate" ? "#59d4e8" : (n.data as BoardNodeData).kind === "clue" ? "#ff7a45" : "#3a4048")} />
        </ReactFlow>
        {!nodes.length && <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-mute">The board grows as the investigation runs.</div>}
        {selected && (
          <div className="absolute right-3 top-3 z-10 w-64 rounded-card border border-line-strong bg-panel/95 p-3 shadow-2xl backdrop-blur">
            <div className="label-mono !text-[9px] text-mute">{selected.data.kind}</div>
            <div className="mt-1 text-[13px] font-medium">{selected.data.title}</div>
            {selected.data.subtitle && <div className="text-[11.5px] text-mute">{selected.data.subtitle}</div>}
            <div className="mt-3 flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => mutateSelected((d) => ({ ...d, pinned: !d.pinned }))}>
                <Pin className="size-3.5" /> {selected.data.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { const t = window.prompt("Note on this card", selected.data.note || ""); if (t !== null) mutateSelected((d) => ({ ...d, note: t || undefined })); }}>
                <StickyNote className="size-3.5" /> Note
              </Button>
              {selected.data.kind === "candidate" && (
                <Button size="sm" variant="ghost" onClick={() => ws.set({ tab: "candidates", selectedCandidateId: selected.data.refId || null })}>
                  <Target className="size-3.5" /> Open
                </Button>
              )}
              {selected.data.kind === "source" && (
                <Button size="sm" variant="ghost" onClick={() => { const s = inv.sources.find((x) => x.id === selected.data.refId); if (s) window.open(s.url, "_blank", "noopener"); }}>
                  <Copy className="size-3.5" /> Open source
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { const next = nodes.filter((n) => n.id !== selected.id); const ne = edges.filter((e) => e.source !== selected.id && e.target !== selected.id); setNodes(next); setEdges(ne); persist(next, ne); setSel(null); }}>
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
            <div className="mt-2 flex gap-1.5" aria-label="Colour tag">
              {TAGS.map((c) => (
                <button key={c} aria-label={`Tag ${c}`} onClick={() => mutateSelected((d) => ({ ...d, userColor: d.userColor === c ? undefined : c }))} className="size-4 rounded-full ring-1 ring-black" style={{ background: c }} />
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-mute">Drag between handles to connect cards. Select an edge and press Delete to remove it.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function useWorkspaceSnapshot() {
  return true;
}

export function EvidenceBoard() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
