"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, CircleDashed, Loader2, XCircle, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import { Wordmark } from "../shell/logo";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea, Switch } from "../ui/form";
import { Alert, Badge } from "../ui/misc";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";
import { RESPONSE_TONES } from "@/lib/constants";
import { IntegrationKeyForm } from "../settings/integration-key-form";
import { EmailConnect } from "../settings/email-connect";

type Integrations = {
  anthropic: { configured: boolean; source: string | null; hint: string | null };
  googlePlaces: { configured: boolean; source: string | null; hint: string | null };
  email: { id: string; provider: string; emailAddress: string; status: string }[];
  googleOAuthAvailable: boolean;
  sandboxAvailable: boolean;
};
type Initial = {
  step: number;
  hasWorkspace: boolean;
  userName: string;
  workspaceName?: string;
  role?: string;
  integrations?: Integrations;
  company?: Record<string, unknown> & { services: string[] };
  automation?: { responseMode: string; responseTone: string; automaticReplies: boolean; automaticFollowUps: boolean; followUpDays: number[] };
};

const STEPS = ["Create workspace", "What you sell", "Connect AI", "Business discovery", "Connect email", "Company information", "Outreach tone", "Automation", "Test connections", "Find businesses"];

export function Onboarding({ initial }: { initial: Initial }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(initial.hasWorkspace ? Math.min(initial.step, 10) : 1);
  const [busy, setBusy] = useState(false);
  const [wsName, setWsName] = useState(initial.workspaceName ?? "");
  const [company, setCompany] = useState<Record<string, unknown>>(initial.company ?? { services: [] });
  const [servicesText, setServicesText] = useState(((initial.company?.services as string[]) ?? []).join("\n"));
  const [automation, setAutomation] = useState(initial.automation ?? { responseMode: "APPROVAL_REQUIRED", responseTone: "Professional", automaticReplies: false, automaticFollowUps: false, followUpDays: [4, 10] });
  const [integrations, setIntegrations] = useState<Integrations | undefined>(initial.integrations);
  const isAdmin = initial.role === "OWNER" || initial.role === "ADMIN" || !initial.hasWorkspace;

  const refreshIntegrations = () => apiFetch<Integrations>("/api/settings/integrations").then(setIntegrations).catch(() => {});

  async function persistStep(n: number) {
    setStep(n);
    if (initial.hasWorkspace || n > 1) await apiFetch("/api/workspace", { method: "PATCH", body: { onboardingStep: n } }).catch(() => {});
  }

  async function next() {
    setBusy(true);
    try {
      if (step === 1) {
        if (!initial.hasWorkspace) {
          await apiFetch("/api/workspaces", { body: { name: wsName } });
          initial.hasWorkspace = true;
        } else await apiFetch("/api/workspace", { method: "PATCH", body: { name: wsName } });
        router.refresh();
        await refreshIntegrations();
      }
      if (step === 2 || step === 6 || step === 7) {
        const services = servicesText.split("\n").map((s) => s.trim()).filter(Boolean);
        const { companyName, senderName, description, website, email, phone, location, targetBusinesses, serviceAreas, meetingLink, brandVoice, typicalFeatures } = company as Record<string, string>;
        await apiFetch("/api/settings/company", { method: "PATCH", body: { companyName, senderName, description, website, email, phone, location, targetBusinesses, serviceAreas, meetingLink, brandVoice, typicalFeatures, services } });
      }
      if (step === 7 || step === 8) await apiFetch("/api/settings/automation", { method: "PATCH", body: step === 7 ? { responseTone: automation.responseTone } : automation });
      await persistStep(step + 1);
    } catch (e) {
      toast.error("Couldn't save this step", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish(href: string) {
    setBusy(true);
    try {
      await apiFetch("/api/workspace", { method: "PATCH", body: { onboardingCompleted: true, onboardingStep: 10 } });
      router.push(href);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't finish setup", (e as Error).message);
      setBusy(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setCompany((c) => ({ ...c, [k]: e.target.value }));
  const v = (k: string) => (company[k] as string) ?? "";

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-8">
        <Wordmark />
        {initial.hasWorkspace && step > 1 && (
          <button onClick={() => finish("/dashboard")} className="text-sm text-muted hover:text-fg">
            Skip setup for now
          </button>
        )}
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[220px_1fr]">
        <ol className="hidden space-y-1 lg:block" aria-label="Setup steps">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const done = n < step;
            return (
              <li key={s}>
                <button disabled={!initial.hasWorkspace || n > step} onClick={() => setStep(n)} className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm", n === step ? "bg-subtle font-medium text-fg" : done ? "text-muted hover:text-fg" : "text-faint")} aria-current={n === step ? "step" : undefined}>
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold", done ? "border-accent bg-accent text-accent-fg" : n === step ? "border-accent text-accent" : "border-border")}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>
                  {s}
                </button>
              </li>
            );
          })}
        </ol>
        <section className="min-w-0">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-faint lg:hidden">Step {step} of 10</div>
          <div className="mb-6 h-1 overflow-hidden rounded-full bg-subtle lg:hidden"><div className="h-full bg-accent transition-all" style={{ width: `${step * 10}%` }} /></div>
          <div className="card p-6 sm:p-8">
            {step === 1 && (
              <Step title={`Welcome to WebScout AI, ${initial.userName.split(" ")[0]}.`} desc="Let's set up your workspace. A workspace holds your leads, settings, email accounts and team.">
                <Field label="Workspace name" htmlFor="ws" hint="Usually your agency or studio name.">
                  <Input id="ws" value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Pixel & Pine Studio" />
                </Field>
              </Step>
            )}
            {step === 2 && (
              <Step title="What do you sell?" desc="The outreach AI only mentions services you list here — it never invents capabilities.">
                <Field label="Describe your business" htmlFor="desc"><Textarea id="desc" value={v("description")} onChange={set("description")} placeholder="We design and build fast, conversion-focused websites for local service businesses." /></Field>
                <Field label="Services you offer (one per line)" htmlFor="svc"><Textarea id="svc" value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder={"Website design\nWebsite development\nLocal SEO setup\nOnline booking integration"} /></Field>
                <Field label="Businesses you target" htmlFor="tgt" hint="e.g. Restaurants and home-service companies in the GTA."><Input id="tgt" value={v("targetBusinesses")} onChange={set("targetBusinesses")} /></Field>
              </Step>
            )}
            {step === 3 && (
              <Step title="Connect your AI provider" desc="WebScout uses Anthropic Claude for website-fact extraction, prompt enhancement, outreach writing and reply analysis. Everything also works in rule-based mode without it — AI makes it deeper.">
                {integrations && <IntegrationKeyForm provider="anthropic" status={integrations.anthropic} disabled={!isAdmin} onChange={refreshIntegrations} />}
              </Step>
            )}
            {step === 4 && (
              <Step title="Connect business discovery" desc="Businesses are found through the official Google Places API (New). You need a Google Maps Platform API key with “Places API (New)” enabled. Optional: enable “PageSpeed Insights API” on the same key for Lighthouse scores.">
                {integrations && <IntegrationKeyForm provider="google-places" status={integrations.googlePlaces} disabled={!isAdmin} onChange={refreshIntegrations} />}
                <p className="text-xs text-muted">You can also add businesses manually or import a CSV without Google.</p>
              </Step>
            )}
            {step === 5 && (
              <Step title="Connect email" desc="Send outreach and receive replies through Gmail (OAuth — we never see your password) or Postmark. Use the Sandbox to try everything without sending real email.">
                {integrations && <EmailConnect integrations={integrations} disabled={!isAdmin} onChange={refreshIntegrations} />}
              </Step>
            )}
            {step === 6 && (
              <Step title="Company information" desc="Used to sign emails and to answer prospects' questions accurately.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Company name" htmlFor="cn"><Input id="cn" value={v("companyName")} onChange={set("companyName")} /></Field>
                  <Field label="Sender name" htmlFor="sn" hint="How you sign emails."><Input id="sn" value={v("senderName")} onChange={set("senderName")} /></Field>
                  <Field label="Website" htmlFor="cw"><Input id="cw" value={v("website")} onChange={set("website")} placeholder="https://" /></Field>
                  <Field label="Business email" htmlFor="ce"><Input id="ce" type="email" value={v("email")} onChange={set("email")} /></Field>
                  <Field label="Phone" htmlFor="cp"><Input id="cp" value={v("phone")} onChange={set("phone")} /></Field>
                  <Field label="Location" htmlFor="cl"><Input id="cl" value={v("location")} onChange={set("location")} /></Field>
                  <Field label="Service areas" htmlFor="ca" className="sm:col-span-2"><Input id="ca" value={v("serviceAreas")} onChange={set("serviceAreas")} placeholder="Mississauga, Brampton, Oakville" /></Field>
                  <Field label="Meeting link (optional)" htmlFor="cm" className="sm:col-span-2" hint="If set, the AI may share it when prospects ask to meet. It never proposes specific times on its own."><Input id="cm" value={v("meetingLink")} onChange={set("meetingLink")} placeholder="https://cal.com/you/intro" /></Field>
                </div>
              </Step>
            )}
            {step === 7 && (
              <Step title="Outreach tone" desc="Sets the voice of AI-written outreach and replies.">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {RESPONSE_TONES.map((t) => (
                    <button key={t} onClick={() => setAutomation((a) => ({ ...a, responseTone: t }))} className={cn("rounded-xl border px-3 py-3 text-left text-sm transition-colors", automation.responseTone === t ? "border-accent bg-accent/5 font-medium" : "border-border hover:bg-subtle")} aria-pressed={automation.responseTone === t}>
                      {t}
                    </button>
                  ))}
                </div>
                <Field label="Brand voice notes" htmlFor="bv" hint="e.g. Plain-spoken, no jargon, no hype. Never use exclamation marks."><Textarea id="bv" value={v("brandVoice")} onChange={set("brandVoice")} /></Field>
              </Step>
            )}
            {step === 8 && (
              <Step title="Automation" desc="You stay in control. By default the AI drafts replies and a human approves them.">
                <Field label="AI response mode" htmlFor="rm">
                  <Select id="rm" value={automation.responseMode} onChange={(e) => setAutomation((a) => ({ ...a, responseMode: e.target.value }))}>
                    <option value="MANUAL">Manual — AI only analyses replies</option>
                    <option value="APPROVAL_REQUIRED">Approval required — AI drafts, you approve (recommended)</option>
                    <option value="AUTOMATIC">Automatic — AI may send qualifying replies under strict rules</option>
                  </Select>
                </Field>
                <div className="divide-y divide-border rounded-xl border border-border px-4">
                  <Switch label="Automatic replies" description="Even when on, legal, complaint, payment, unsubscribe, low-confidence and unclear messages always go to human review." checked={automation.automaticReplies} onChange={(x) => setAutomation((a) => ({ ...a, automaticReplies: x }))} disabled={!isAdmin} />
                  <Switch label="Automatic follow-ups" description="Off: follow-ups wait for your approval when due." checked={automation.automaticFollowUps} onChange={(x) => setAutomation((a) => ({ ...a, automaticFollowUps: x }))} disabled={!isAdmin} />
                </div>
                <Field label="Follow-up schedule (days after first email)" htmlFor="fu" hint="Follow-ups stop automatically when a business replies, says no, unsubscribes or becomes a customer.">
                  <Input id="fu" value={automation.followUpDays.join(", ")} onChange={(e) => setAutomation((a) => ({ ...a, followUpDays: e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => n > 0) }))} />
                </Field>
              </Step>
            )}
            {step === 9 && <HealthStep />}
            {step === 10 && (
              <Step title="Find your first businesses" desc="You're ready. Search a location and category, or explore a separate workspace with clearly-labelled demo data.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button onClick={() => finish("/discover")} className="rounded-2xl border border-accent/40 bg-accent/5 p-5 text-left transition-colors hover:bg-accent/10" disabled={busy}>
                    <div className="font-semibold">Find businesses</div>
                    <p className="mt-1 text-sm text-muted">Search Google Places by location and category.</p>
                  </button>
                  <button onClick={() => finish("/leads?add=1")} className="rounded-2xl border border-border p-5 text-left transition-colors hover:bg-subtle" disabled={busy}>
                    <div className="font-semibold">Add or import leads</div>
                    <p className="mt-1 text-sm text-muted">Add a business manually or import a CSV.</p>
                  </button>
                  <button
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await apiFetch("/api/workspace", { method: "PATCH", body: { onboardingCompleted: true, onboardingStep: 10 } });
                        await apiFetch("/api/demo", { body: {} });
                        router.push("/dashboard");
                        router.refresh();
                      } catch (e) {
                        toast.error("Couldn't create demo workspace", (e as Error).message);
                        setBusy(false);
                      }
                    }}
                    className="rounded-2xl border border-dashed border-border p-5 text-left transition-colors hover:bg-subtle sm:col-span-2"
                    disabled={busy}
                  >
                    <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-amber-500" /> Explore with demo data <Badge tone="amber">DEMO DATA</Badge></div>
                    <p className="mt-1 text-sm text-muted">Creates a separate demo workspace with sample businesses and a sandbox mailbox. Never mixed with your real data.</p>
                  </button>
                </div>
                {busy && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Setting things up…</p>}
              </Step>
            )}
            {step < 10 && (
              <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || busy}>
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <div className="flex items-center gap-2">
                  {[3, 4, 5].includes(step) && <Button variant="ghost" onClick={() => persistStep(step + 1)}>Skip</Button>}
                  <Button onClick={next} loading={busy} disabled={step === 1 && wsName.trim().length < 2}>
                    Continue <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Step({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1.5 text-sm text-muted">{desc}</p>
      </div>
      {children}
    </div>
  );
}

type Health = { name: string; status: "ok" | "warning" | "error" | "off"; detail: string; action?: string }[];
function HealthStep() {
  const [items, setItems] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const run = () => {
    setLoading(true);
    apiFetch<Health>("/api/admin/health?live=1").then(setItems).catch((e) => setItems([{ name: "Health check", status: "error", detail: (e as Error).message }])).finally(() => setLoading(false));
  };
  useEffect(run, []);
  return (
    <Step title="Test connections" desc="We check each integration live. Anything not connected can be added later in Settings.">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {loading && !items && <li className="flex items-center gap-2 px-4 py-4 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Testing connections…</li>}
        {items?.map((i) => (
          <li key={i.name} className="flex items-start gap-3 px-4 py-3">
            {i.status === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : i.status === "error" ? <XCircle className="mt-0.5 h-4 w-4 text-danger" /> : i.status === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-faint" />}
            <div className="min-w-0">
              <div className="text-sm font-medium">{i.name}</div>
              <div className="text-[13px] text-muted">{i.detail}</div>
              {i.action && <div className="mt-0.5 text-[13px] text-accent">{i.action}</div>}
            </div>
          </li>
        ))}
      </ul>
      <Button variant="outline" onClick={run} loading={loading} loadingText="Testing…">Re-test</Button>
      {items?.some((i) => i.status === "off") && <Alert tone="info" title="Some integrations aren't connected">Features that need them will show “Connect … to enable this feature” instead of fake results.</Alert>}
    </Step>
  );
}
