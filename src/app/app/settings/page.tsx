"use client";
import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { ws } from "@/lib/client/store";
import { Button, Field, Label, Panel, Spinner, Toggle, cn, inputCls } from "@/components/ui";

interface Prefs {
  aiModel: string;
  aiEnabled: boolean;
  webProvider: string;
  mapProvider: string;
  ocrProvider: string;
  imageSearchProvider: string;
  animation: "full" | "reduced" | "off";
  maxQueriesQuick: number;
  maxQueriesDeep: number;
  retentionDays: number;
  officialSourcesOnly: boolean;
  debug: boolean;
}
type KeyState = Record<string, "environment" | "user" | "missing">;
interface Provider {
  id: string;
  label: string;
  area: string;
  state: "ready" | "keyless" | "needs-key";
  envVar?: string;
  note?: string;
}

const KEY_HELP: Record<string, string> = {
  GEMINI_API_KEY: "Google Gemini — free: image reading, AI geolocation, AI chat with web/map tools, explanations. Get a key at aistudio.google.com/apikey. Preferred over Claude unless AI_PROVIDER=claude.",
  ANTHROPIC_API_KEY: "Claude multimodal vision, AI chat with tools, AI explanations and comparisons — console.anthropic.com",
  GOOGLE_CLOUD_VISION_API_KEY: "Logo, landmark, OCR and web detection (legitimate reverse-image signals) — Google Cloud console, enable Cloud Vision API",
  BRAVE_SEARCH_API_KEY: "Web, news, image and video search — api-dashboard.search.brave.com",
  TAVILY_API_KEY: "Web and news search — tavily.com",
  SERPAPI_API_KEY: "Google Lens reverse image search through SerpApi — serpapi.com",
  GOOGLE_MAPS_API_KEY: "Places API (New) and Geocoding — Google Maps Platform",
  YOUTUBE_API_KEY: "Public video metadata search — Google Cloud console, YouTube Data API v3",
  MAPILLARY_ACCESS_TOKEN: "Mapillary street-level photos for visual matching near candidate locations — free client token at mapillary.com/developer",
};

export default function Settings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [keys, setKeys] = useState<KeyState>({});
  const [providers, setProviders] = useState<Provider[]>([]);
  const [storageName, setStorage] = useState("");
  const [saved, setSaved] = useState(false);
  const [keyInput, setKeyInput] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    const s = await api.get<{ prefs: Prefs; keys: KeyState; storage: string }>("/api/settings");
    setPrefs(s.prefs);
    setKeys(s.keys);
    setStorage(s.storage);
    const p = await api.get<{ providers: Provider[] }>("/api/providers");
    setProviders(p.providers);
  };
  useEffect(() => {
    void load();
  }, []);

  if (!prefs)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs({ ...prefs, [k]: v });
  const save = async () => {
    const r = await api.get<{ prefs: Prefs }>("/api/settings").catch(() => null);
    void r;
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) });
    ws.set({ providers: null, animation: prefs.animation });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    void load();
  };
  const saveKey = async (k: string, value: string | null) => {
    setBusyKey(k);
    await fetch("/api/settings/keys", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, value }) });
    setKeyInput((x) => ({ ...x, [k]: "" }));
    ws.set({ providers: null });
    await load();
    setBusyKey(null);
  };
  const sel = (k: keyof Prefs, opts: [string, string][]) => (
    <select value={String(prefs[k])} onChange={(e) => set(k, e.target.value as never)} className={inputCls}>
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-8 md:px-8">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-mono text-cyan">Configuration</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Settings</h1>
          </div>
          <Button variant="primary" onClick={save}>
            {saved ? <Check className="size-4" /> : null} {saved ? "Saved" : "Save settings"}
          </Button>
        </div>

        <Panel title="Providers status">
          <ul className="divide-y divide-line">
            {providers.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                <span className={cn("size-2 shrink-0 rounded-full", p.state === "ready" ? "bg-ok" : p.state === "keyless" ? "bg-cyan" : "bg-white/20")} />
                <span className="w-24 shrink-0 text-mute">{p.area}</span>
                <span className="flex-1">{p.label}</span>
                <span className={cn("label-mono !text-[9px]", p.state === "needs-key" ? "text-warn" : "text-dim")}>{p.state === "needs-key" ? `needs ${p.envVar}` : p.state === "keyless" ? "keyless · live" : "configured"}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="AI provider">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Model" hint="Applies when Claude is the active AI (AI_PROVIDER=claude). Gemini picks its fastest available free model automatically.">
              {sel("aiModel", [
                ["claude-opus-5-5", "Claude Opus 5.5"],
                ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
                ["claude-haiku-4-5", "Claude Haiku 4.5"],
              ])}
            </Field>
            <div className="pt-6">
              <Toggle label="Use AI when a key is configured" checked={prefs.aiEnabled} onChange={(v) => set("aiEnabled", v)} />
            </div>
          </div>
        </Panel>

        <Panel title="Search, maps, OCR & images">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Web search provider">{sel("webProvider", [["auto", "Auto (keyed providers first, then Wikipedia)"], ["brave", "Brave Search"], ["tavily", "Tavily"], ["wikipedia", "Wikipedia only (keyless)"]])}</Field>
            <Field label="Map provider">{sel("mapProvider", [["osm", "OpenStreetMap (keyless)"], ["google", "Google Maps Platform"]])}</Field>
            <Field label="OCR provider" hint="Tesseract runs in your browser. Cloud Vision adds server-side OCR when configured.">
              {sel("ocrProvider", [["tesseract", "Tesseract (in-browser)"], ["google-vision", "Tesseract + Google Cloud Vision"]])}
            </Field>
            <Field label="Image search provider">{sel("imageSearchProvider", [["commons", "Wikimedia Commons (keyless)"], ["serpapi-lens", "SerpApi Google Lens (reverse)"]])}</Field>
            <div className="sm:col-span-2">
              <Toggle label="Prefer official sources only (filters web results to official/government domains)" checked={prefs.officialSourcesOnly} onChange={(v) => set("officialSourcesOnly", v)} />
            </div>
          </div>
        </Panel>

        <Panel title="Cost control & research budget">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Max queries — Quick Scan">
              <input type="number" min={4} max={40} value={prefs.maxQueriesQuick} onChange={(e) => set("maxQueriesQuick", Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Max queries — Deep Investigation">
              <input type="number" min={8} max={120} value={prefs.maxQueriesDeep} onChange={(e) => set("maxQueriesDeep", Number(e.target.value))} className={inputCls} />
            </Field>
            <p className="text-[12px] leading-relaxed text-mute sm:col-span-2">
              All provider responses are cached (Wikidata and maps for 7–14 days, search for 24 h) and identical concurrent requests are deduplicated. Images are resized in the browser before upload. Each mode sets its own query budget, and research branches stop once the budget is reached.
            </p>
          </div>
        </Panel>

        <Panel title="Display & privacy">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Animation intensity" hint="Reduced motion is respected automatically.">
              {sel("animation", [["full", "Full cinematic"], ["reduced", "Reduced (simple transitions)"], ["off", "Off (no cinematic sequence)"]])}
            </Field>
            <Field label="Data retention (days, 0 = keep until deleted)" hint="Investigations not updated within this many days are permanently deleted, together with their images, the next time your list loads.">
              <input type="number" min={0} max={3650} value={prefs.retentionDays} onChange={(e) => set("retentionDays", Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Theme">
              <select disabled className={inputCls}>
                <option>Dark (investigation)</option>
              </select>
            </Field>
            <div className="pt-6">
              <Toggle label="Developer debug panel" checked={prefs.debug} onChange={(v) => set("debug", v)} />
            </div>
            <div className="flex items-start gap-2 text-[12px] text-dim sm:col-span-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> Storage: <span className="text-fg">{storageName}</span>. Investigations are private to your account. Deleting an investigation also deletes its images.
            </div>
          </div>
        </Panel>

        <Panel title="API keys">
          <div className="p-4">
            <p className="mb-4 text-[12.5px] leading-relaxed text-dim">
              Keys are stored on the server, never in browser code. Environment variables set in the hosting dashboard take priority. Keys entered here are encrypted at rest (AES-256-GCM) and are never sent back to the browser.
            </p>
            <ul className="space-y-3">
              {Object.entries(keys).map(([k, st]) => (
                <li key={k} className="rounded-[5px] border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="size-3.5 text-mute" />
                    <span className="font-mono text-[12.5px]">{k}</span>
                    <span className={cn("label-mono rounded-[3px] px-1.5 !text-[9px]", st === "missing" ? "bg-white/5 text-mute" : "bg-ok/10 text-ok")}>{st === "environment" ? "set in environment" : st === "user" ? "set (encrypted)" : "not set"}</span>
                  </div>
                  <div className="mt-1 text-[11.5px] text-mute">{KEY_HELP[k]}</div>
                  {st !== "environment" && (
                    <div className="mt-2 flex gap-2">
                      <input type="password" autoComplete="off" placeholder={st === "user" ? "•••••••• (replace)" : "Paste key"} value={keyInput[k] || ""} onChange={(e) => setKeyInput((x) => ({ ...x, [k]: e.target.value }))} className={cn(inputCls, "h-8")} aria-label={k} />
                      <Button size="sm" onClick={() => saveKey(k, keyInput[k] || null)} disabled={!keyInput[k] || busyKey === k}>
                        {busyKey === k ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                      </Button>
                      {st === "user" && (
                        <Button size="sm" variant="ghost" onClick={() => saveKey(k, null)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <Label className="pb-6 text-center">Future-ready modules (video frames, audio, PDF, satellite & street-view comparison, shadow/sun analysis) plug into the same provider interfaces.</Label>
      </div>
    </div>
  );
}
