"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CircleStop, Download, Play, Plug, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "../ui/button";
import { Alert, Card, CardHeader, EmptyState, PageHeader, Progress } from "../ui/misc";
import { Tabs } from "../ui/tabs";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "../ui/form";
import { RelTime } from "../ui/time";
import { useToast } from "../ui/toast";
import { LiveMap, type MapPoint } from "../map/live-map";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";
import { type ClaudeEvent, type ClaudeTask, CopyButton, EventRow, sayToClaude, shortId, TaskStatusBadge } from "./shared";

type Conn = { id: string; name: string; tokenHint: string; lastSeenAt: string | null; lastClient: string | null; companionSeenAt: string | null; deviceName: string | null; platform: string | null; createdAt: string; state: "active" | "ready" | "idle" | "never" | "revoked" };
type State = { state: "active" | "ready" | "idle" | "not_connected"; paused: boolean; connections: Conn[]; tasks: ClaudeTask[]; events: ClaudeEvent[]; counts: Record<string, number> };
type Perms = { connect: boolean; run: boolean; stop: boolean };

const STATE_TEXT: Record<State["state"], { label: string; cls: string }> = {
  active: { label: "Claude is connected and working", cls: "bg-emerald-500" },
  ready: { label: "Claude Desktop is open — ready for tasks", cls: "bg-sky-500" },
  idle: { label: "Connected — Claude isn't active right now", cls: "bg-zinc-400" },
  not_connected: { label: "Claude isn't connected yet", cls: "bg-amber-500" },
};
const CONN_STATE: Record<Conn["state"], string> = { active: "Working now", ready: "Desktop open", idle: "Idle", never: "Not used yet", revoked: "Removed" };

export function CommandCentre({ initial, perms, selectedLeads }: { initial: State; perms: Perms; selectedLeads: string[] }) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const live = s.tasks.some((t) => t.status === "RUNNING");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const [c, m] = await Promise.all([apiFetch<State>("/api/claude"), apiFetch<{ points: MapPoint[] }>("/api/map/points?claude=1&limit=500")]);
        if (alive) {
          setS(c);
          setPoints(m.points);
        }
      } catch {
        /* keep the last good state */
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function stopOrResume(action: "stop" | "resume") {
    setBusy(action);
    try {
      setS(await apiFetch<State>("/api/claude", { body: { action } }));
      toast.success(action === "stop" ? "Everything is stopped" : "Automation resumed", action === "stop" ? "Claude tasks, searches, AutoProspect runs and automated sending are paused." : "Paused Claude tasks are back in the queue.");
      setConfirmStop(false);
    } catch (e) {
      toast.error("Not changed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(c: Conn) {
    if (!confirm(`Remove “${c.name}”? Claude will no longer be able to use this link.`)) return;
    try {
      await apiFetch(`/api/claude/connections/${c.id}`, { method: "DELETE" });
      setS((x) => ({ ...x, connections: x.connections.filter((y) => y.id !== c.id) }));
      toast.success("Connection removed");
    } catch (e) {
      toast.error("Couldn't remove it", (e as Error).message);
    }
  }

  const st = STATE_TEXT[s.paused ? "idle" : s.state];
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" /> Claude</span>}
        title="Claude Command Centre"
        description="Give Claude research tasks with your Claude subscription, watch it work live, and approve anything before it reaches a customer."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium">
              <span className={cn("h-2 w-2 rounded-full", s.paused ? "bg-red-500" : st.cls)} /> {s.paused ? "Everything is paused" : st.label}
            </span>
            {perms.stop && (s.paused ? (
              <Button size="sm" onClick={() => stopOrResume("resume")} loading={busy === "resume"}><Play className="h-4 w-4" /> Resume everything</Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmStop(true)}><CircleStop className="h-4 w-4" /> Emergency stop</Button>
            ))}
          </div>
        }
      />
      {s.paused && <Alert tone="danger" title="Emergency stop is on">Claude is refused any further work, and searches, AutoProspect runs and automated sending are paused until you resume.</Alert>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          {s.connections.length === 0 ? (
            <Card>
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Plug className="h-6 w-6" /></div>
                <div className="flex-1">
                  <div className="font-semibold">Connect Claude to WebScout</div>
                  <p className="mt-1 text-sm text-muted">Uses your own Claude plan (Pro, Max or higher) — no API key. Claude researches businesses on the web (or with computer use in Claude Desktop) and sends real, sourced results straight into your CRM.</p>
                </div>
                {perms.connect ? <Button onClick={() => setConnectOpen(true)}><Plug className="h-4 w-4" /> Connect Claude</Button> : <span className="text-sm text-muted">Ask an admin to connect Claude.</span>}
              </div>
            </Card>
          ) : null}

          {perms.run && <NewTask selectedLeads={selectedLeads} onCreated={(t) => setS((x) => ({ ...x, tasks: [t, ...x.tasks] }))} />}

          <Card>
            <CardHeader title="Live map" description="Every business Claude finds drops onto the map. Click a pin for details, or open it in 3D." />
            <div className="p-4 pt-0"><LiveMap points={points} live={live} height={420} emptyText="Businesses Claude finds will appear here." /></div>
          </Card>

          <Card>
            <CardHeader title="Tasks" description={`${s.counts.QUEUED ?? 0} waiting · ${s.counts.RUNNING ?? 0} running · ${s.counts.COMPLETED ?? 0} completed`} />
            {s.tasks.length === 0 ? (
              <EmptyState className="pb-8" icon={<Sparkles className="h-5 w-5" />} title="No tasks yet" description="Create a task above, then tell Claude: “Run my next WebScout task”." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Task</th><th>Status</th><th className="w-40">Progress</th><th>Results</th><th>Created</th></tr></thead>
                  <tbody>
                    {s.tasks.map((t) => (
                      <tr key={t.id}>
                        <td className="max-w-[320px]"><Link href={`/claude/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="font-mono text-[11px] text-faint">#{shortId(t.id)}</div></td>
                        <td><TaskStatusBadge status={t.status} /></td>
                        <td><Progress value={t.progress} /><div className="mt-1 truncate text-[11px] text-muted">{t.progressMessage}</div></td>
                        <td className="whitespace-nowrap text-xs text-muted">{t.stats.created ?? 0} new · {t.stats.duplicates ?? 0} known{t.stats.drafts ? ` · ${t.stats.drafts} drafts` : ""}</td>
                        <td className="whitespace-nowrap text-xs text-muted"><RelTime d={t.createdAt} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Connections" description="Claude links to this workspace" action={perms.connect && s.connections.length > 0 && <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)}><Plus className="h-4 w-4" /> Add</Button>} />
            {s.connections.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">None yet.</p> : (
              <ul className="divide-y divide-border">
                {s.connections.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", c.state === "active" ? "bg-emerald-500" : c.state === "ready" ? "bg-sky-500" : "bg-zinc-400")} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.name} <span className="font-mono text-xs text-faint">…{c.tokenHint}</span></div>
                      <div className="text-xs text-muted">{CONN_STATE[c.state]}{c.lastSeenAt ? <> · last used <RelTime d={c.lastSeenAt} /></> : ""}{c.deviceName ? ` · ${c.deviceName}` : ""}</div>
                      {c.lastClient && <div className="truncate text-[11px] text-faint">{c.lastClient}</div>}
                    </div>
                    {perms.connect && <button type="button" onClick={() => revoke(c)} aria-label={`Remove ${c.name}`} className="rounded p-1 text-muted hover:bg-subtle hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Live activity" description="Updates every few seconds" />
            {s.events.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Nothing yet — activity from Claude shows up here as it happens.</p> : (
              <ul className="max-h-[560px] overflow-y-auto px-5 pb-4 scrollbar-thin">{s.events.map((e) => <EventRow key={e.id} e={e} showTask />)}</ul>
            )}
          </Card>
        </div>
      </div>

      <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} onCreated={(c) => setS((x) => ({ ...x, connections: [c, ...x.connections], state: x.state === "not_connected" ? "idle" : x.state }))} />
      <ConfirmDialog open={confirmStop} onClose={() => setConfirmStop(false)} title="Stop everything now?" confirmLabel="Emergency stop" loading={busy === "stop"} onConfirm={() => stopOrResume("stop")} description="Claude is refused any further work immediately, and all searches, AutoProspect runs and automated sending pause. Nothing is deleted — resume any time." />
    </div>
  );
}

function NewTask({ selectedLeads, onCreated }: { selectedLeads: string[]; onCreated: (t: ClaudeTask) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<"find" | "research">(selectedLeads.length ? "research" : "find");
  const [f, setF] = useState({ locations: "", types: "", count: "10", websiteFilter: "none_or_weak", smallOnly: true, findContacts: true, notes: "" });
  const [r, setR] = useState({ pickBest: "5", emails: "none", focus: "" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ClaudeTask | null>(null);
  const split = (v: string, re: RegExp) => v.split(re).map((x) => x.trim()).filter((x) => x.length >= 2);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body =
      tab === "find"
        ? { type: "FIND_LEADS", params: { locations: split(f.locations, /\n|;/), businessTypes: split(f.types, /,|\n/), count: Number(f.count), websiteFilter: f.websiteFilter, smallOnly: f.smallOnly, findContacts: f.findContacts, notes: f.notes } }
        : { type: "RESEARCH_LEADS", params: { businessIds: selectedLeads, pickBest: selectedLeads.length ? 0 : Number(r.pickBest), emails: r.emails, focus: r.focus } };
    if (tab === "find" && (!body.params.locations?.length || !(body.params as { businessTypes: string[] }).businessTypes.length)) return toast.error("Add at least one location and one type of business");
    setBusy(true);
    try {
      const { task } = await apiFetch<{ task: ClaudeTask }>("/api/claude/tasks", { body });
      setCreated(task);
      onCreated(task);
    } catch (err) {
      toast.error("Couldn't create the task", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" /> New task for Claude</span>} description="Claude does the research; WebScout checks every result before it's saved." />
      <div className="px-5 pb-5">
        <Tabs tabs={[{ id: "find", label: "Find new leads" }, { id: "research", label: selectedLeads.length ? `Research ${selectedLeads.length} selected leads` : "Research my leads" }]} value={tab} onChange={(v) => { setTab(v); setCreated(null); }} />
        {created ? (
          <div className="mt-4 space-y-3">
            <Alert tone="success" title={`Task #${shortId(created.id)} is ready for Claude`}>Open Claude (Desktop or claude.ai) with the WebScout connector turned on and say:</Alert>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-subtle px-3 py-2">
              <code className="flex-1 font-mono text-sm">{sayToClaude(created.id)}</code>
              <CopyButton text={sayToClaude(created.id)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/claude/tasks/${created.id}`}>Watch it live →</ButtonLink>
              <Button variant="ghost" onClick={() => setCreated(null)}>Create another</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
            {tab === "find" ? (
              <>
                <Field label="Where" htmlFor="ct-loc" hint="One per line — cities, provinces or countries" className="sm:col-span-1"><Textarea id="ct-loc" rows={3} value={f.locations} onChange={(e) => setF({ ...f, locations: e.target.value })} placeholder={"Mississauga, ON\nOakville, ON"} /></Field>
                <Field label="Types of business" htmlFor="ct-types" hint="Separate with commas" className="sm:col-span-1"><Textarea id="ct-types" rows={3} value={f.types} onChange={(e) => setF({ ...f, types: e.target.value })} placeholder="restaurants, bakeries, hair salons" /></Field>
                <Field label="How many" htmlFor="ct-count" hint="Up to 50 per task"><Input id="ct-count" type="number" min={1} max={50} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
                <Field label="Websites" htmlFor="ct-web">
                  <Select id="ct-web" value={f.websiteFilter} onChange={(e) => setF({ ...f, websiteFilter: e.target.value })}>
                    <option value="none_or_weak">No website or a weak one (best leads)</option>
                    <option value="none">No website at all</option>
                    <option value="any">Any</option>
                  </Select>
                </Field>
                <Field label="Anything else Claude should know?" htmlFor="ct-notes" className="sm:col-span-2"><Input id="ct-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. family-owned places with good reviews but no online ordering" /></Field>
                <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
                  <Checkbox checked={f.smallOnly} onChange={(v) => setF({ ...f, smallOnly: v })} label="Small businesses only (no chains or landmarks)" />
                  <Checkbox checked={f.findContacts} onChange={(v) => setF({ ...f, findContacts: v })} label="Find published business emails" />
                </div>
              </>
            ) : (
              <>
                {!selectedLeads.length && <Field label="How many leads" htmlFor="ct-best" hint="Your highest-opportunity leads that Claude hasn't researched yet"><Input id="ct-best" type="number" min={1} max={25} value={r.pickBest} onChange={(e) => setR({ ...r, pickBest: e.target.value })} /></Field>}
                <Field label="Emails" htmlFor="ct-emails" hint="Drafts wait for your approval — Claude never sends anything">
                  <Select id="ct-emails" value={r.emails} onChange={(e) => setR({ ...r, emails: e.target.value })}>
                    <option value="none">Research only</option>
                    <option value="outreach">Research + write a personal email draft</option>
                    <option value="quote">Research + write a detailed quote email draft</option>
                  </Select>
                </Field>
                <Field label="What to focus on (optional)" htmlFor="ct-focus" className="sm:col-span-2"><Textarea id="ct-focus" rows={2} value={r.focus} onChange={(e) => setR({ ...r, focus: e.target.value })} placeholder="e.g. do they take bookings online? who are their competitors?" /></Field>
              </>
            )}
            <div className="sm:col-span-2"><Button type="submit" loading={busy} loadingText="Creating…"><Bot className="h-4 w-4" /> Create task for Claude</Button></div>
          </form>
        )}
      </div>
    </Card>
  );
}

function ConnectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Conn) => void }) {
  const toast = useToast();
  const [name, setName] = useState("Claude Desktop");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [how, setHow] = useState<"connector" | "extension">("connector");

  async function create() {
    setBusy(true);
    try {
      const r = await apiFetch<{ connection: Conn; url: string }>("/api/claude/connections", { body: { name } });
      setLink(r.url);
      onCreated(r.connection);
    } catch (e) {
      toast.error("Couldn't create the link", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setLink(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} size="lg" title="Connect Claude" description="Claude uses your own Claude plan. WebScout never sees your Claude login." footer={link ? <Button onClick={close}>Done</Button> : <><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={create} loading={busy}>Create connection link</Button></>}>
      {!link ? (
        <Field label="Name this connection" htmlFor="cc-name" hint="So you can tell connections apart, e.g. “Home PC”."><Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <div className="label">Your connection link</div>
            <div className="flex gap-2"><Input readOnly value={link} onFocus={(e) => e.target.select()} className="font-mono text-xs" /><CopyButton text={link} /></div>
            <p className="hint">Keep it private — anyone with this link can add leads to your workspace. You can remove it any time. It won&apos;t be shown again.</p>
          </div>
          <Tabs tabs={[{ id: "connector", label: "Claude app (no install)" }, { id: "extension", label: "Desktop extension" }]} value={how} onChange={setHow} />
          {how === "connector" ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-muted">
              <li>Open Claude (Claude Desktop or claude.ai) → <b className="text-fg">Settings → Connectors</b> (or <b className="text-fg">Customize → Connectors</b>).</li>
              <li>Click <b className="text-fg">Add custom connector</b>. Name: <b className="text-fg">WebScout AI</b>. URL: paste the link above. Choose no sign-in — the link is the key.</li>
              <li>In a new chat, make sure WebScout AI is switched on in the tools menu.</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-5 text-muted">
              <li><a href="/api/claude/extension" className="font-medium text-accent hover:underline"><Download className="mr-1 inline h-4 w-4" />Download the WebScout extension</a> (webscout-ai.mcpb).</li>
              <li>Double-click it — or in Claude Desktop open <b className="text-fg">Settings → Extensions</b> and install it from the file.</li>
              <li>Paste the link above when it asks for your WebScout connection link. Claude Desktop stores it in Windows Credential Manager (Keychain on Mac).</li>
            </ol>
          )}
          <Alert tone="info" title="Optional: let Claude use your computer">In Claude Desktop, turn on <b>computer use</b> in Settings so Claude can browse business websites on your PC. Without it, Claude uses its own web search — usually faster.</Alert>
          <div className="rounded-lg border border-border bg-subtle p-3"><b>Test it:</b> in Claude, say <code className="font-mono">Check my WebScout status</code>. This page shows “connected” within a few seconds.</div>
        </div>
      )}
    </Dialog>
  );
}

