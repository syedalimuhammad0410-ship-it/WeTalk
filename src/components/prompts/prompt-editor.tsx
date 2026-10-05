"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, Download, History, Maximize2, Minimize2, Minus, Plus, RefreshCcw, Save, Shrink, Expand, Wand2, Gauge } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/misc";
import { Dialog, ConfirmDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { cn, formatDateTime } from "@/lib/utils";
import { RelTime, DateTimeText } from "@/components/ui/time";

type Version = { id: string; version: number; changeType: string; generator: string; qualityScore: number | null; qualityBreakdown: Record<string, { score: number; notes: string[] }> | null; wordCount: number; note: string | null; createdAt: string; content: string };
type Props = { prompt: { id: string; title: string; currentVersion: number; business: { id: string; name: string }; versions: Version[] }; features: { key: string; name: string; included: boolean }[]; qualityLabels: Record<string, string>; canEdit: boolean };

const CHANGE_LABEL: Record<string, string> = { GENERATED: "Generated", REGENERATED: "Regenerated", EDITED: "Edited", IMPROVED: "Improved", SHORTENED: "Made concise", EXPANDED: "Made more detailed", FEATURE_ADDED: "Feature added", FEATURE_REMOVED: "Feature removed", RESTORED: "Restored" };

export function PromptEditor({ prompt, features, qualityLabels, canEdit }: Props) {
  const router = useRouter();
  const toast = useToast();
  const latest = prompt.versions[0]!;
  const [content, setContent] = useState(latest.content);
  const [baseline, setBaseline] = useState(latest.content);
  const [busy, setBusy] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [panel, setPanel] = useState<"quality" | "history">("quality");
  const [featureDialog, setFeatureDialog] = useState<null | "add" | "remove">(null);
  const [viewing, setViewing] = useState<Version | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState<null | (() => void)>(null);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = content !== baseline;

  useEffect(() => {
    setContent(latest.content);
    setBaseline(latest.content);
  }, [latest.id, latest.content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && canEdit) save();
      }
      if (e.key === "Escape" && focus) setFocus(false);
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  });

  const words = useMemo(() => content.split(/\s+/).filter(Boolean).length, [content]);

  async function save() {
    setBusy("save");
    try {
      const r = await apiFetch<{ version: number; quality?: number; unchanged?: boolean }>(`/api/prompts/${prompt.id}`, { method: "PUT", body: { content } });
      setBaseline(content);
      toast.success(r.unchanged ? "No changes to save" : `Saved as version ${r.version}`, r.quality ? `Quality ${r.quality}/100` : undefined);
      router.refresh();
    } catch (e) {
      toast.error("Not saved", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function guard(fn: () => void) {
    if (dirty) setConfirmOverwrite(() => fn);
    else fn();
  }

  async function transform(op: "IMPROVE" | "SHORTEN" | "EXPAND" | "ADD_FEATURE" | "REMOVE_FEATURE", feature?: string) {
    setBusy(op);
    try {
      const r = await apiFetch<{ version: number; quality: number; notes: string[] }>(`/api/prompts/${prompt.id}/transform`, { body: { op, feature } });
      toast.success(`Version ${r.version} created`, `${r.notes.join(" ")} Quality ${r.quality}/100.`);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't update prompt", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    setBusy("regen");
    try {
      const r = await apiFetch<{ version: number; quality: number }>(`/api/leads/${prompt.business.id}/prompt`, { body: {} });
      toast.success(`Regenerated as version ${r.version}`, `Quality ${r.quality}/100`);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't regenerate", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success("Prompt copied", "Only the prompt text was copied — paste it into your AI builder.");
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${prompt.business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-website-prompt.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const q = latest.qualityBreakdown;
  return (
    <div className={cn("flex flex-col", focus ? "fixed inset-0 z-[60] bg-bg p-3 sm:p-5" : "h-[calc(100vh-7.5rem)] min-h-[600px]")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!focus && <Link href={`/leads/${prompt.business.id}?tab=prompt`} className="mr-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> {prompt.business.name}</Link>}
        <div className="flex items-center gap-2">
          <Badge tone={(latest.qualityScore ?? 0) >= 85 ? "green" : "amber"}>Quality {latest.qualityScore ?? "—"}/100</Badge>
          <span className="text-xs text-muted">v{latest.version} · {words.toLocaleString()} words{dirty && " · unsaved changes"}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={copy} variant={copied ? "subtle" : "primary"}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy full prompt"}</Button>
          <Button size="sm" variant="outline" onClick={download}><Download className="h-4 w-4" /> Download</Button>
          {canEdit && <Button size="sm" variant="outline" onClick={save} disabled={!dirty} loading={busy === "save"}><Save className="h-4 w-4" /> Save</Button>}
          <Button size="sm" variant="ghost" onClick={() => setFocus((v) => !v)} aria-label={focus ? "Exit full screen" : "Full screen"}>{focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</Button>
        </div>
      </div>
      {canEdit && (
        <div className="mb-3 flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface p-1.5" role="toolbar" aria-label="Prompt actions">
          <Button size="sm" variant="ghost" onClick={() => guard(regenerate)} loading={busy === "regen"} loadingText="Generating prompt…"><RefreshCcw className="h-4 w-4" /> Regenerate</Button>
          <Button size="sm" variant="ghost" onClick={() => guard(() => transform("IMPROVE"))} loading={busy === "IMPROVE"} loadingText="Improving…"><Wand2 className="h-4 w-4" /> Improve</Button>
          <Button size="sm" variant="ghost" onClick={() => guard(() => transform("EXPAND"))} loading={busy === "EXPAND"} loadingText="Expanding…"><Expand className="h-4 w-4" /> Make more detailed</Button>
          <Button size="sm" variant="ghost" onClick={() => guard(() => transform("SHORTEN"))} loading={busy === "SHORTEN"} loadingText="Shortening…"><Shrink className="h-4 w-4" /> Make more concise</Button>
          <Button size="sm" variant="ghost" onClick={() => setFeatureDialog("add")} disabled={Boolean(busy)}><Plus className="h-4 w-4" /> Add feature</Button>
          <Button size="sm" variant="ghost" onClick={() => setFeatureDialog("remove")} disabled={Boolean(busy)}><Minus className="h-4 w-4" /> Remove feature</Button>
          {busy && busy !== "save" && <span className="ml-auto self-center pr-2 text-xs text-muted">This can take up to a minute with AI enabled…</span>}
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <textarea
          ref={area}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={!canEdit}
          spellCheck={false}
          aria-label="Website prompt"
          className="input min-h-[400px] resize-none rounded-xl p-4 font-mono text-[12.5px] leading-relaxed lg:min-h-0"
        />
        <aside className="card flex min-h-0 flex-col overflow-hidden">
          <div className="flex border-b border-border text-sm">
            {(["quality", "history"] as const).map((p) => (
              <button key={p} onClick={() => setPanel(p)} className={cn("flex flex-1 items-center justify-center gap-1.5 py-2.5 font-medium", panel === p ? "border-b-2 border-accent text-fg" : "text-muted")} aria-pressed={panel === p}>
                {p === "quality" ? <Gauge className="h-4 w-4" /> : <History className="h-4 w-4" />} {p === "quality" ? "Quality" : `History (${prompt.versions.length})`}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {panel === "quality" && (
              <div className="space-y-3">
                <p className="text-xs text-muted">Scored on 10 dimensions (10 points each). Prompts below 85 are automatically improved before being shown.</p>
                {q ? Object.entries(q).map(([k, v]) => (
                  <div key={k}>
                    <div className="flex justify-between text-[13px]"><span>{qualityLabels[k] ?? k}</span><span className="tabular-nums font-medium">{v.score}/10</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle"><div className={cn("h-full rounded-full", v.score >= 9 ? "bg-green-500" : v.score >= 7 ? "bg-blue-500" : "bg-amber-500")} style={{ width: `${v.score * 10}%` }} /></div>
                    {v.notes.length > 0 && <p className="mt-1 text-[11px] text-faint">{v.notes.join("; ")}</p>}
                  </div>
                )) : <p className="text-sm text-muted">No quality data for this version.</p>}
                {latest.note && <div className="mt-4 rounded-lg bg-subtle p-3 text-xs text-muted"><div className="mb-1 font-medium text-fg">Generation notes</div>{latest.note}</div>}
              </div>
            )}
            {panel === "history" && (
              <ol className="space-y-2">
                {prompt.versions.map((v) => (
                  <li key={v.id} className={cn("rounded-lg border p-3", v.version === latest.version ? "border-accent/40 bg-accent/5" : "border-border")}>
                    <div className="flex items-center justify-between text-sm"><span className="font-medium">Version {v.version}</span>{v.qualityScore != null && <span className="text-xs tabular-nums text-muted">{v.qualityScore}/100</span>}</div>
                    <div className="text-xs text-muted">{CHANGE_LABEL[v.changeType] ?? v.changeType} · {v.generator === "AI" ? "AI" : v.generator === "MANUAL" ? "Manual" : "Rules"} · {v.wordCount.toLocaleString()} words</div>
                    <div className="text-[11px] text-faint"><DateTimeText d={v.createdAt} /></div>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(v)}>View</Button>
                      {canEdit && v.version !== latest.version && <Button size="sm" variant="outline" loading={busy === `r${v.version}`} onClick={() => guard(async () => { setBusy(`r${v.version}`); try { await apiFetch(`/api/prompts/${prompt.id}/restore`, { body: { version: v.version } }); toast.success(`Restored version ${v.version}`); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } })}>Restore</Button>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
      <Dialog open={featureDialog !== null} onClose={() => setFeatureDialog(null)} title={featureDialog === "add" ? "Add a feature" : "Remove a feature"} description={featureDialog === "add" ? "The specification will be updated throughout (pages, functionality, forms, analytics, acceptance criteria)." : "The feature will be removed everywhere and marked as not to be built."}>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {features.filter((f) => (featureDialog === "add" ? !f.included : f.included)).map((f) => (
            <li key={f.key}><button className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-subtle" onClick={() => { const op = featureDialog === "add" ? "ADD_FEATURE" : "REMOVE_FEATURE"; setFeatureDialog(null); guard(() => transform(op, f.key)); }}>{f.name}</button></li>
          ))}
        </ul>
      </Dialog>
      <Dialog open={Boolean(viewing)} onClose={() => setViewing(null)} title={`Version ${viewing?.version}`} size="xl" footer={<Button variant="outline" onClick={() => { if (viewing) navigator.clipboard.writeText(viewing.content); toast.success("Copied"); }}><Copy className="h-4 w-4" /> Copy this version</Button>}>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{viewing?.content}</pre>
      </Dialog>
      <ConfirmDialog open={Boolean(confirmOverwrite)} onClose={() => setConfirmOverwrite(null)} tone="primary" title="You have unsaved edits" confirmLabel="Save edits first, then continue" description="Your edits will be saved as a new version so nothing is lost." onConfirm={async () => { const fn = confirmOverwrite!; setConfirmOverwrite(null); await save(); fn(); }} />
    </div>
  );
}
