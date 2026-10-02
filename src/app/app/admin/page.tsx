"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Panel, Spinner, cn } from "@/components/ui";

interface Ev {
  at: string;
  provider: string;
  op: string;
  ok: boolean;
  status?: number;
  ms: number;
  cached?: boolean;
  error?: string;
  costUnits?: number;
}
interface Admin {
  storage: string;
  instance: { recent: Ev[]; cache: { memHits: number; storeHits: number; misses: number }; uptimeSec: number; node: string };
  days: Record<string, Record<string, { calls: number; errors: number; cached: number; ms: number; cost: number }>>;
  errors: Ev[];
}

export default function AdminPage() {
  const [d, setD] = useState<Admin | null>(null);
  const [provs, setProvs] = useState<{ id: string; label: string; state: string }[]>([]);
  const load = async () => {
    setD(await api.get<Admin>("/api/admin"));
    setProvs((await api.get<{ providers: { id: string; label: string; state: string }[] }>("/api/providers")).providers);
  };
  useEffect(() => {
    void load();
  }, []);
  if (!d)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  const totals: Record<string, { calls: number; errors: number; cached: number; ms: number; cost: number }> = {};
  for (const day of Object.values(d.days))
    for (const [p, v] of Object.entries(day)) {
      const t = (totals[p] ||= { calls: 0, errors: 0, cached: 0, ms: 0, cost: 0 });
      t.calls += v.calls;
      t.errors += v.errors;
      t.cached += v.cached;
      t.ms += v.ms;
      t.cost += v.cost;
    }
  const c = d.instance.cache;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 px-5 py-8 md:px-8">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-mono text-cyan">Developer</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Debug & usage</h1>
            <p className="text-[12px] text-mute">
              Storage: {d.storage} · Node {d.instance.node} · instance uptime {Math.round(d.instance.uptimeSec / 60)} min
            </p>
          </div>
          <Button onClick={load}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Calls (7 days)", Object.values(totals).reduce((a, b) => a + b.calls, 0)],
            ["Errors (7 days)", Object.values(totals).reduce((a, b) => a + b.errors, 0)],
            ["Cache hits (instance)", c.memHits + c.storeHits],
            ["Cache misses (instance)", c.misses],
          ].map(([l, v]) => (
            <div key={l} className="rounded-card border border-line bg-panel p-4">
              <div className="label-mono text-mute">{l}</div>
              <div className="mt-1 font-mono text-[24px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <Panel title="Providers (last 7 days)">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-mute">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-normal">Provider</th>
                <th className="px-2 font-normal">Calls</th>
                <th className="px-2 font-normal">Errors</th>
                <th className="px-2 font-normal">Cached</th>
                <th className="px-2 font-normal">Avg latency</th>
                <th className="px-2 font-normal">Cost units</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(totals).map(([p, t]) => (
                <tr key={p} className="border-b border-line/60">
                  <td className="px-4 py-1.5 font-mono">{p}</td>
                  <td className="px-2">{t.calls}</td>
                  <td className={cn("px-2", t.errors && "text-alert")}>{t.errors}</td>
                  <td className="px-2">{t.cached}</td>
                  <td className="px-2">{Math.round(t.ms / Math.max(1, t.calls - t.cached))} ms</td>
                  <td className="px-2">{t.cost}</td>
                </tr>
              ))}
              {!Object.keys(totals).length && (
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-mute">
                    No usage recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-mute">Cost units: tokens for AI calls, the provider's billing unit for search/maps (e.g. YouTube quota units), and requests otherwise.</p>
        </Panel>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Provider status">
            <ul className="divide-y divide-line text-[12.5px]">
              {provs.map((p) => (
                <li key={p.id} className="flex justify-between px-4 py-1.5">
                  <span>{p.label}</span>
                  <span className={p.state === "needs-key" ? "text-warn" : "text-ok"}>{p.state}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Recent errors">
            <ul className="max-h-80 divide-y divide-line overflow-y-auto font-mono text-[11.5px]">
              {!d.errors.length && <li className="px-4 py-3 text-mute">No errors recorded.</li>}
              {d.errors.map((e, i) => (
                <li key={i} className="px-4 py-1.5">
                  <span className="text-mute">{e.at.slice(5, 19).replace("T", " ")}</span> <span className="text-alert">{e.provider}</span> {e.op} — {e.error}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title="Recent requests (this server instance)">
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto font-mono text-[11.5px]">
            {d.instance.recent.map((e, i) => (
              <li key={i} className="flex gap-3 px-4 py-1">
                <span className="text-mute">{e.at.slice(11, 19)}</span>
                <span className={e.ok ? "text-ok" : "text-alert"}>{e.ok ? "OK " : "ERR"}</span>
                <span className="w-36 shrink-0 truncate">{e.provider}</span>
                <span className="w-28 shrink-0 truncate text-dim">{e.op}</span>
                <span className="w-16 shrink-0 text-right">{e.cached ? "cache" : `${e.ms}ms`}</span>
                <span className="truncate text-mute">{e.error}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
