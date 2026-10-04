"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Mail, RefreshCw, Trash2, UserPlus, FlaskConical, Download } from "lucide-react";
import { Card, CardHeader, Badge, Alert } from "../ui/misc";
import { Button } from "../ui/button";
import { Field, Input, Select, Switch, Textarea } from "../ui/form";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch, setThemeCookie } from "@/lib/client";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { AI_MODELS, RESPONSE_TONES } from "@/lib/constants";
import { ROLE_LABEL } from "@/lib/permissions";
import { IntegrationKeyForm } from "./integration-key-form";
import { EmailConnect } from "./email-connect";

type D = any;
const can = (d: D, p: string) => (d.permissions as string[]).includes(p);

function useSaver(endpoint: string, method = "PATCH") {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (body: unknown, ok = "Saved") => {
    setBusy(true);
    try {
      await apiFetch(endpoint, { method, body });
      toast.success(ok);
      router.refresh();
      return true;
    } catch (e) {
      toast.error("Not saved", (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}

function Section({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-4 p-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
    </Card>
  );
}

export function SettingsSection({ data }: { data: D }) {
  return (
    <div className="space-y-5">
      {data.error && <Alert tone="danger" title={data.error} />}
      {data.connected === "gmail" && <Alert tone="success" title="Gmail connected. Outreach will send from this mailbox and replies are checked every few minutes." />}
      {{
        account: <Account d={data} />,
        workspace: <Workspace d={data} />,
        users: <Users d={data} />,
        company: <Company d={data} />,
        integrations: <Integrations d={data} />,
        ai: <AiSettings d={data} />,
        email: <EmailSettings d={data} />,
        automation: <Automation d={data} />,
        "follow-ups": <FollowUpSettings d={data} />,
        compliance: <Compliance d={data} />,
        notifications: <Notifications d={data} />,
        data: <DataSettings d={data} />,
        security: <Security d={data} />,
      }[data.section as string]}
    </div>
  );
}

function Account({ d }: { d: D }) {
  const [name, setName] = useState(d.user.name);
  const [theme, setTheme] = useState<string>(typeof document !== "undefined" ? document.documentElement.dataset.themePref ?? "system" : "system");
  const { save, busy } = useSaver("/api/me");
  const pw = useSaver("/api/me/password", "POST");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  return (
    <>
      <Section title="Profile" footer={<Button loading={busy} onClick={() => save({ name })}>Save</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="a-n"><Input id="a-n" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email" htmlFor="a-e" hint={d.user.hasGoogle ? "Linked to Google sign-in" : undefined}><Input id="a-e" value={d.user.email} readOnly /></Field>
        </div>
      </Section>
      <Section title="Appearance">
        <Field label="Theme" htmlFor="a-t"><Select id="a-t" value={theme} onChange={(e) => { setTheme(e.target.value); setThemeCookie(e.target.value as "light"); save({ themePreference: e.target.value }, "Theme updated"); }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></Select></Field>
      </Section>
      <Section title={d.user.hasPassword ? "Change password" : "Set a password"} footer={<Button loading={pw.busy} disabled={next.length < 10} onClick={async () => { if (await pw.save({ current: cur, next }, "Password updated")) { setCur(""); setNext(""); } }}>Update password</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {d.user.hasPassword && <Field label="Current password" htmlFor="a-c"><Input id="a-c" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>}
          <Field label="New password" htmlFor="a-p" hint="At least 10 characters with letters and numbers."><Input id="a-p" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        </div>
      </Section>
    </>
  );
}

function Workspace({ d }: { d: D }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(d.workspace.name);
  const { save, busy } = useSaver("/api/workspace");
  const [del, setDel] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Section title="Workspace" footer={can(d, "users.manage") && <Button loading={busy} onClick={() => save({ name })}>Save</Button>}>
        <Field label="Workspace name" htmlFor="w-n"><Input id="w-n" value={name} onChange={(e) => setName(e.target.value)} readOnly={!can(d, "users.manage")} /></Field>
        {d.workspace.isDemo && <Alert tone="warning" title="This is a DEMO DATA workspace." >It is separate from your real workspaces.</Alert>}
        <Button variant="outline" onClick={() => { apiFetch("/api/workspace", { method: "PATCH", body: { onboardingCompleted: false } }).then(() => router.push("/onboarding")); }}>Re-run setup wizard</Button>
      </Section>
      {can(d, "workspace.delete") && (
        <Section title="Danger zone">
          <p className="text-sm text-muted">Deleting the workspace permanently removes all {d.counts.leads} leads, {d.counts.conversations} conversations, {d.counts.campaigns} campaigns, settings and connected accounts.</p>
          <Button variant="danger" onClick={() => setDel(true)}><Trash2 className="h-4 w-4" /> Delete workspace</Button>
        </Section>
      )}
      <ConfirmDialog open={del} onClose={() => setDel(false)} title="Delete workspace permanently?" confirmLabel="Delete everything" loading={deleting} confirmDisabled={confirm !== d.workspace.name} onConfirm={async () => { setDeleting(true); try { await apiFetch("/api/workspace", { method: "DELETE", body: { confirmName: confirm } }); router.push("/onboarding"); router.refresh(); } catch (e) { toast.error((e as Error).message); setDeleting(false); } }} description="This cannot be undone. Export your leads first if you need them.">
        <Field label={`Type “${d.workspace.name}” to confirm`} htmlFor="w-c" className="mt-3"><Input id="w-c" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}

function Users({ d }: { d: D }) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can(d, "users.manage");
  return (
    <>
      <Section title="Members" description="Roles control who can send email, enable automatic replies, change API settings, delete or export data and manage users.">
        <ul className="divide-y divide-border rounded-xl border border-border">
          {d.members.map((m: any) => (
            <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.user.name}{m.user.id === d.currentUserId && <span className="text-muted"> (you)</span>}</div><div className="text-xs text-muted">{m.user.email}</div></div>
              {manage && m.user.id !== d.currentUserId ? (
                <div className="flex gap-2">
                  <Select value={m.role} className="h-8 w-auto py-0 text-sm" aria-label={`Role for ${m.user.name}`} onChange={async (e) => { try { await apiFetch(`/api/workspace/members/${m.id}`, { method: "PATCH", body: { role: e.target.value } }); toast.success("Role updated"); router.refresh(); } catch (err) { toast.error((err as Error).message); } }}>
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${m.user.name}`} onClick={async () => { if (!confirm(`Remove ${m.user.email} from this workspace?`)) return; try { await apiFetch(`/api/workspace/members/${m.id}`, { method: "DELETE" }); router.refresh(); } catch (err) { toast.error((err as Error).message); } }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ) : <Badge tone="slate">{ROLE_LABEL[m.role as keyof typeof ROLE_LABEL]}</Badge>}
            </li>
          ))}
        </ul>
        {d.invitations.length > 0 && <div className="text-sm"><div className="mb-1 font-medium">Pending invitations</div>{d.invitations.map((i: any) => <div key={i.id} className="text-muted">{i.email} · {i.role.toLowerCase()} · expires {formatDateTime(i.expiresAt)}</div>)}</div>}
      </Section>
      {manage && (
        <Section title="Invite a teammate" footer={<Button loading={busy} disabled={!email} onClick={async () => { setBusy(true); try { const r = await apiFetch<{ link: string }>("/api/workspace/members", { body: { email, role } }); setLink(r.link); setEmail(""); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}><UserPlus className="h-4 w-4" /> Create invite link</Button>}>
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Email" htmlFor="u-e"><Input id="u-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role" htmlFor="u-r"><Select id="u-r" value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLE_LABEL).filter(([k]) => k !== "OWNER" || d.role === "OWNER").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          {link && <Alert tone="success" title="Share this invite link (valid 7 days)"><span className="break-all font-mono text-xs">{link}</span><Button size="sm" variant="outline" className="mt-2" onClick={() => { navigator.clipboard.writeText(link); toast.success("Copied"); }}><Copy className="h-3.5 w-3.5" /> Copy</Button></Alert>}
          <table className="table-base text-xs"><thead><tr><th>Permission</th><th>Owner</th><th>Admin</th><th>Member</th><th>Viewer</th></tr></thead><tbody>
            {[["View leads", 1, 1, 1, 1], ["Edit leads, run discovery & audits", 1, 1, 1, 0], ["Send emails / approve AI drafts", 1, 1, 1, 0], ["Enable automatic replies", 1, 1, 0, 0], ["Change API & compliance settings", 1, 1, 0, 0], ["Delete & export leads", 1, 1, 0, 0], ["Manage users", 1, 1, 0, 0], ["Delete workspace", 1, 0, 0, 0]].map(([l, ...r]) => <tr key={l as string}><td>{l}</td>{r.map((x, i) => <td key={i}>{x ? "✓" : "—"}</td>)}</tr>)}
          </tbody></table>
        </Section>
      )}
    </>
  );
}

function Company({ d }: { d: D }) {
  const c = d.settings.company;
  const [v, setV] = useState({ ...c, services: c.services.join("\n") });
  const { save, busy } = useSaver("/api/settings/company");
  const set = (k: string) => (e: any) => setV((s: any) => ({ ...s, [k]: e.target.value }));
  const editable = can(d, "leads.edit");
  const adminOnly = can(d, "compliance.manage");
  return (
    <Section title="Company profile" description="What the outreach and reply AI knows about you. It never claims capabilities, prices or availability that aren't listed here." footer={editable && <Button loading={busy} onClick={() => save({ companyName: v.companyName, senderName: v.senderName, description: v.description, services: v.services.split("\n").map((s: string) => s.trim()).filter(Boolean), website: v.website, email: v.email, phone: v.phone, location: v.location, targetBusinesses: v.targetBusinesses, serviceAreas: v.serviceAreas, typicalFeatures: v.typicalFeatures, meetingLink: v.meetingLink, brandVoice: v.brandVoice, ...(adminOnly ? { pricingEnabled: v.pricingEnabled, pricingDetails: v.pricingDetails, permittedClaims: v.permittedClaims } : {}) })}>Save profile</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" htmlFor="c1"><Input id="c1" value={v.companyName} onChange={set("companyName")} /></Field>
        <Field label="Sender name" htmlFor="c2"><Input id="c2" value={v.senderName} onChange={set("senderName")} /></Field>
        <Field label="Description" htmlFor="c3" className="sm:col-span-2"><Textarea id="c3" value={v.description} onChange={set("description")} /></Field>
        <Field label="Services (one per line)" htmlFor="c4" className="sm:col-span-2"><Textarea id="c4" value={v.services} onChange={set("services")} /></Field>
        <Field label="Website" htmlFor="c5"><Input id="c5" value={v.website} onChange={set("website")} /></Field>
        <Field label="Email" htmlFor="c6"><Input id="c6" value={v.email} onChange={set("email")} /></Field>
        <Field label="Phone" htmlFor="c7"><Input id="c7" value={v.phone} onChange={set("phone")} /></Field>
        <Field label="Location" htmlFor="c8"><Input id="c8" value={v.location} onChange={set("location")} /></Field>
        <Field label="Target businesses" htmlFor="c9"><Input id="c9" value={v.targetBusinesses} onChange={set("targetBusinesses")} /></Field>
        <Field label="Service areas" htmlFor="c10"><Input id="c10" value={v.serviceAreas} onChange={set("serviceAreas")} /></Field>
        <Field label="Typical website features you build" htmlFor="c11" className="sm:col-span-2"><Textarea id="c11" value={v.typicalFeatures} onChange={set("typicalFeatures")} /></Field>
        <Field label="Meeting link" htmlFor="c12" hint="Shared only when a prospect asks to meet."><Input id="c12" value={v.meetingLink} onChange={set("meetingLink")} placeholder="https://" /></Field>
        <Field label="Brand voice" htmlFor="c13"><Input id="c13" value={v.brandVoice} onChange={set("brandVoice")} /></Field>
      </div>
      <div className="rounded-xl border border-border p-4">
        <Switch label="Allow the AI to quote pricing" description="Off: the AI never states a price and offers a tailored quote instead." checked={v.pricingEnabled} onChange={(x) => setV((s: any) => ({ ...s, pricingEnabled: x }))} disabled={!adminOnly} />
        {v.pricingEnabled && <Field label="Pricing details" htmlFor="c14" hint="Exactly what the AI may say, e.g. “Websites start at $2,500 CAD; final price depends on scope.”"><Textarea id="c14" value={v.pricingDetails} onChange={set("pricingDetails")} readOnly={!adminOnly} /></Field>}
        <Field label="Permitted claims" htmlFor="c15" hint="Facts the AI may state about you (e.g. “10 years building restaurant websites”). Admin only."><Textarea id="c15" value={v.permittedClaims} onChange={set("permittedClaims")} readOnly={!adminOnly} /></Field>
      </div>
    </Section>
  );
}

function Integrations({ d }: { d: D }) {
  const router = useRouter();
  const dis = !can(d, "integrations.manage");
  return (
    <>
      <Section title="Business discovery — Google Places API (New)" description="Required for Find Businesses. Optional: enable PageSpeed Insights API on the same key for Lighthouse scores in audits.">
        <IntegrationKeyForm provider="google-places" status={d.integrations.googlePlaces} disabled={dis} onChange={() => router.refresh()} />
      </Section>
      <Section title="AI provider — Anthropic" description="Powers fact extraction, prompt enhancement, outreach writing, reply analysis and drafting. All AI output passes anti-hallucination checks.">
        <IntegrationKeyForm provider="anthropic" status={d.integrations.anthropic} disabled={dis} onChange={() => router.refresh()} />
      </Section>
    </>
  );
}

function AiSettings({ d }: { d: D }) {
  const a = d.settings.automation;
  const [v, setV] = useState({ aiModel: a.aiModel, aiEffort: a.aiEffort, responseTone: a.responseTone, maxResponseWords: a.maxResponseWords, responseMode: a.responseMode, autoReplyMinConfidence: a.autoReplyMinConfidence, humanReviewBelowConfidence: a.humanReviewBelowConfidence, promptBehavior: a.promptBehavior });
  const { save, busy } = useSaver("/api/settings/automation");
  const dis = !can(d, "automation.manage");
  return (
    <Section title="AI settings" description={`Provider: Anthropic (${d.integrations.anthropic.configured ? "connected" : "not connected"}). Temperature isn't exposed: current Claude models use adaptive reasoning; use the effort level instead.`} footer={!dis && <Button loading={busy} onClick={() => save({ ...v, maxResponseWords: +v.maxResponseWords, autoReplyMinConfidence: +v.autoReplyMinConfidence, humanReviewBelowConfidence: +v.humanReviewBelowConfidence })}>Save</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Model" htmlFor="m"><Select id="m" value={v.aiModel} onChange={(e) => setV({ ...v, aiModel: e.target.value })} disabled={dis}>{AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        <Field label="Reasoning effort" htmlFor="ef" hint="Higher = more thorough, slower, more tokens."><Select id="ef" value={v.aiEffort} onChange={(e) => setV({ ...v, aiEffort: e.target.value })} disabled={dis}>{["low", "medium", "high", "xhigh"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
        <Field label="Response tone" htmlFor="tn"><Select id="tn" value={v.responseTone} onChange={(e) => setV({ ...v, responseTone: e.target.value })} disabled={dis}>{RESPONSE_TONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Maximum response length (words)" htmlFor="mx"><Input id="mx" type="number" min={40} max={600} value={v.maxResponseWords} onChange={(e) => setV({ ...v, maxResponseWords: e.target.value as any })} disabled={dis} /></Field>
        <Field label="Default response mode" htmlFor="rm"><Select id="rm" value={v.responseMode} onChange={(e) => setV({ ...v, responseMode: e.target.value })} disabled={dis}><option value="MANUAL">Manual — analyse only</option><option value="APPROVAL_REQUIRED">Approval required (default)</option><option value="AUTOMATIC">Automatic — strict safeguards</option></Select></Field>
        <Field label="Auto-reply minimum confidence (%)" htmlFor="ac" hint="Below this, a human must approve."><Input id="ac" type="number" min={50} max={100} value={v.autoReplyMinConfidence} onChange={(e) => setV({ ...v, autoReplyMinConfidence: e.target.value as any })} disabled={dis} /></Field>
        <Field label="Flag for human review below (%)" htmlFor="hr"><Input id="hr" type="number" min={0} max={100} value={v.humanReviewBelowConfidence} onChange={(e) => setV({ ...v, humanReviewBelowConfidence: e.target.value as any })} disabled={dis} /></Field>
        <Field label="Website-prompt behaviour" htmlFor="pb" className="sm:col-span-2" hint="Extra instructions appended to every generated website prompt (e.g. preferred stack)."><Textarea id="pb" value={v.promptBehavior} onChange={(e) => setV({ ...v, promptBehavior: e.target.value })} disabled={dis} placeholder="Use Next.js + Tailwind. Target WCAG 2.2 AA." /></Field>
      </div>
    </Section>
  );
}

function EmailSettings({ d }: { d: D }) {
  const router = useRouter();
  const toast = useToast();
  const dis = !can(d, "integrations.manage");
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <Section title="Connected accounts" description="We never store email passwords: Gmail uses OAuth; Postmark uses an API token encrypted at rest.">
        {d.accounts.length === 0 && <p className="text-sm text-muted">No email account connected yet.</p>}
        <ul className="space-y-3">
          {d.accounts.map((a: any) => (
            <li key={a.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                {a.provider === "SANDBOX" ? <FlaskConical className="h-4 w-4 text-sky-500" /> : <Mail className="h-4 w-4 text-muted" />}
                <span className="font-medium">{a.emailAddress}</span>
                <Badge tone={a.provider === "SANDBOX" ? "sky" : "slate"}>{a.provider === "SANDBOX" ? "SANDBOX — not delivered" : a.provider === "GMAIL" ? "Gmail" : "Postmark"}</Badge>
                <Badge tone={a.status === "ERROR" ? "red" : "green"} dot>{a.status === "ERROR" ? "Error" : "Connected"}</Badge>
                {a.isDefault && <Badge tone="indigo">Default sender</Badge>}
              </div>
              <dl className="mt-3 grid gap-1 text-[13px] text-muted sm:grid-cols-2">
                <div>Sending identity: {a.displayName ? `${a.displayName} <${a.emailAddress}>` : a.emailAddress}</div>
                <div>Reply-to: {a.replyTo || "same as sender"}</div>
                <div>Daily limit: {d.settings.compliance.maxEmailsPerDay}/day · {d.settings.compliance.maxEmailsPerHour}/hour</div>
                <div>Automatic responses: {d.settings.automation.automaticReplies && d.settings.automation.responseMode === "AUTOMATIC" ? "On (strict rules)" : "Off"}</div>
                {a.provider === "GMAIL" && <div>Last inbox check: {a.lastSyncAt ? timeAgo(a.lastSyncAt) : "never"}</div>}
                {a.provider === "POSTMARK" && <div>Reply routing: {a.inboundAddress ? `${a.inboundAddress} (+tracking hash)` : "by headers & sender"}</div>}
              </dl>
              {a.lastError && <p className="mt-2 text-xs text-danger">{a.lastError}</p>}
              {!dis && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing({ ...a })}>Edit identity & signature</Button>
                  <Button size="sm" variant="outline" loading={busy === `t${a.id}`} onClick={async () => { setBusy(`t${a.id}`); try { const r = await apiFetch<{ ok: boolean; message?: string; error?: string }>(`/api/email-accounts/${a.id}/test`, { body: {} }); if (r.ok) toast.success("Connection OK", r.message); else toast.error("Connection failed", r.error); router.refresh(); } finally { setBusy(null); } }}>Send test</Button>
                  {a.provider === "GMAIL" && <Button size="sm" variant="outline" loading={busy === `s${a.id}`} onClick={async () => { setBusy(`s${a.id}`); try { const r = await apiFetch<{ message: string }>(`/api/email-accounts/${a.id}/sync`, { body: {} }); toast.info(r.message); } finally { setBusy(null); } }}><RefreshCw className="h-4 w-4" /> Check inbox</Button>}
                  {!a.isDefault && <Button size="sm" variant="ghost" onClick={async () => { await apiFetch(`/api/email-accounts/${a.id}`, { method: "PATCH", body: { isDefault: true } }); router.refresh(); }}>Make default</Button>}
                  <Button size="sm" variant="ghost" onClick={async () => { if (!confirm(`Disconnect ${a.emailAddress}? Message history is kept.`)) return; await apiFetch(`/api/email-accounts/${a.id}`, { method: "DELETE" }); router.refresh(); }}><Trash2 className="h-4 w-4" /> Disconnect</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Connect an account"><EmailConnect integrations={d.integrations} disabled={dis} onChange={() => router.refresh()} /></Section>
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title="Sending identity" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy === "e"} onClick={async () => { setBusy("e"); try { await apiFetch(`/api/email-accounts/${editing.id}`, { method: "PATCH", body: { displayName: editing.displayName, replyTo: editing.replyTo, signature: editing.signature, ...(editing.provider === "POSTMARK" ? { inboundAddress: editing.inboundAddress ?? "" } : {}) } }); toast.success("Saved"); setEditing(null); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } }}>Save</Button></>}>
        {editing && <div className="space-y-4">
          <Field label="Display name" htmlFor="ed"><Input id="ed" value={editing.displayName} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} /></Field>
          <Field label="Reply-to" htmlFor="er"><Input id="er" type="email" value={editing.replyTo} onChange={(e) => setEditing({ ...editing, replyTo: e.target.value })} /></Field>
          {editing.provider === "POSTMARK" && <Field label="Postmark inbound address" htmlFor="ei"><Input id="ei" type="email" value={editing.inboundAddress ?? ""} onChange={(e) => setEditing({ ...editing, inboundAddress: e.target.value })} /></Field>}
          <Field label="Signature" htmlFor="es"><Textarea id="es" value={editing.signature} onChange={(e) => setEditing({ ...editing, signature: e.target.value })} placeholder={"Alex Chen\nPixel & Pine Studio\nhttps://pixelandpine.com"} /></Field>
        </div>}
      </Dialog>
    </>
  );
}

function Automation({ d }: { d: D }) {
  const a = d.settings.automation;
  const keys = ["aiWebsiteAnalysis", "aiPromptGeneration", "aiOutreachGeneration", "aiResponseAnalysis", "aiResponseDrafting", "automaticReplies", "automaticFollowUps", "requireSendConfirmation"] as const;
  const [v, setV] = useState<Record<string, boolean>>(Object.fromEntries(keys.map((k) => [k, a[k]])));
  const { save } = useSaver("/api/settings/automation");
  const dis = !can(d, "automation.manage");
  const autoDis = !can(d, "autoReplies.enable");
  const toggle = async (k: string, x: boolean) => { setV((s) => ({ ...s, [k]: x })); if (!(await save({ [k]: x }, `${x ? "Enabled" : "Disabled"}`))) setV((s) => ({ ...s, [k]: !x })); };
  const rows: [string, string, string, boolean][] = [
    ["aiWebsiteAnalysis", "AI website analysis", "Extracts verified facts (services, claims) from audited sites. Rule-based audits always run.", dis],
    ["aiPromptGeneration", "AI prompt generation", "Deepens rule-based website prompts with AI; output is fact-checked.", dis],
    ["aiOutreachGeneration", "AI outreach generation", "Writes personalised outreach from verified observations; falls back to templates.", dis],
    ["aiResponseAnalysis", "AI response analysis", "Classifies replies in context. Rule-based safety classification always runs.", dis],
    ["aiResponseDrafting", "AI response drafting", "Drafts replies for approval.", dis],
    ["automaticReplies", "Automatic replies", "Lets the AI send qualifying replies in Automatic mode. Never for legal, complaints, payments, unsubscribes, low confidence or unclear messages.", autoDis],
    ["automaticFollowUps", "Automatic follow-ups", "Sends due follow-ups without approval (campaigns can still require approval).", autoDis],
    ["requireSendConfirmation", "Require confirmation before sending outreach", "Shows recipient, subject, message, business, source and campaign before each send.", dis],
  ];
  return (
    <Section title="Automation" description={`Response mode: ${a.responseMode.replace("_", " ").toLowerCase()} (change in AI settings). Each switch is independent and every change is logged.`}>
      <div className="divide-y divide-border">{rows.map(([k, l, desc, disabled]) => <Switch key={k} label={l} description={desc} checked={v[k]!} onChange={(x) => toggle(k, x)} disabled={disabled} />)}</div>
      {autoDis && <p className="text-xs text-muted">Only owners and admins can enable automatic sending.</p>}
    </Section>
  );
}

function FollowUpSettings({ d }: { d: D }) {
  const [days, setDays] = useState(d.settings.automation.followUpDays.join(", "));
  const [max, setMax] = useState(d.settings.compliance.maxFollowUps);
  const a = useSaver("/api/settings/automation");
  const c = useSaver("/api/settings/compliance");
  return (
    <Section title="Follow-ups" description="Businesses are never contacted endlessly. Follow-ups stop when the business replies, says no, unsubscribes, is stopped manually, or becomes a customer." footer={can(d, "automation.manage") && <Button loading={a.busy || c.busy} onClick={async () => { await a.save({ followUpDays: days.split(",").map((x: string) => Number(x.trim())).filter((n: number) => n > 0) }); if (can(d, "compliance.manage")) await c.save({ maxFollowUps: +max }); }}>Save</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Schedule (days after initial email)" htmlFor="fd" hint="e.g. 4, 10"><Input id="fd" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Maximum follow-ups per business" htmlFor="fm" hint="0–5. Admin only."><Input id="fm" type="number" min={0} max={5} value={max} onChange={(e) => setMax(e.target.value as any)} disabled={!can(d, "compliance.manage")} /></Field>
      </div>
      <p className="text-sm text-muted">Mode: {d.settings.automation.automaticFollowUps ? "automatic (within sending limits)" : "approval required"} — change in Automation.</p>
    </Section>
  );
}

function Compliance({ d }: { d: D }) {
  const router = useRouter();
  const toast = useToast();
  const c = d.settings.compliance;
  const [v, setV] = useState({ ...c });
  const { save, busy } = useSaver("/api/settings/compliance");
  const dis = !can(d, "compliance.manage");
  const [sup, setSup] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const num = (k: string) => (e: any) => setV((s: any) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <Section title="Sending safeguards" description="Enforced on every send — manual, bulk, follow-up and automatic." footer={!dis && <Button loading={busy} onClick={() => save({ maxEmailsPerDay: +v.maxEmailsPerDay, maxEmailsPerHour: +v.maxEmailsPerHour, minMinutesBetweenSends: +v.minMinutesBetweenSends, minDaysBetweenContacts: +v.minDaysBetweenContacts, maxFollowUps: +v.maxFollowUps, includeUnsubscribeFooter: v.includeUnsubscribeFooter, unsubscribeText: v.unsubscribeText, physicalAddress: v.physicalAddress, aiDisclosureEnabled: v.aiDisclosureEnabled, aiDisclosureText: v.aiDisclosureText, blockFreeEmailDomains: v.blockFreeEmailDomains })}>Save</Button>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Max emails / day" htmlFor="p1"><Input id="p1" type="number" value={v.maxEmailsPerDay} onChange={num("maxEmailsPerDay")} disabled={dis} /></Field>
          <Field label="Max emails / hour" htmlFor="p2"><Input id="p2" type="number" value={v.maxEmailsPerHour} onChange={num("maxEmailsPerHour")} disabled={dis} /></Field>
          <Field label="Minimum minutes between sends" htmlFor="p3"><Input id="p3" type="number" value={v.minMinutesBetweenSends} onChange={num("minMinutesBetweenSends")} disabled={dis} /></Field>
          <Field label="Minimum days between contacts" htmlFor="p4"><Input id="p4" type="number" value={v.minDaysBetweenContacts} onChange={num("minDaysBetweenContacts")} disabled={dis} /></Field>
          <Field label="Max follow-ups" htmlFor="p5"><Input id="p5" type="number" value={v.maxFollowUps} onChange={num("maxFollowUps")} disabled={dis} /></Field>
        </div>
        <div className="divide-y divide-border rounded-xl border border-border px-4">
          <Switch label="Append unsubscribe line to outreach & follow-ups" checked={v.includeUnsubscribeFooter} onChange={(x) => setV({ ...v, includeUnsubscribeFooter: x })} disabled={dis} />
          <Switch label="Disclose AI assistance on AI-drafted emails" description="Adds your disclosure text to emails the AI wrote." checked={v.aiDisclosureEnabled} onChange={(x) => setV({ ...v, aiDisclosureEnabled: x })} disabled={dis} />
          <Switch label="Block cold outreach to free personal email domains" description="e.g. gmail.com, yahoo.com — helps avoid contacting individuals." checked={v.blockFreeEmailDomains} onChange={(x) => setV({ ...v, blockFreeEmailDomains: x })} disabled={dis} />
        </div>
        <Field label="Unsubscribe text" htmlFor="p6"><Textarea id="p6" value={v.unsubscribeText} onChange={(e) => setV({ ...v, unsubscribeText: e.target.value })} disabled={dis} /></Field>
        <Field label="Physical mailing address" htmlFor="p7" hint="Required by CAN-SPAM/CASL for commercial email."><Input id="p7" value={v.physicalAddress} onChange={(e) => setV({ ...v, physicalAddress: e.target.value })} disabled={dis} /></Field>
        <Field label="AI disclosure text" htmlFor="p8"><Input id="p8" value={v.aiDisclosureText} onChange={(e) => setV({ ...v, aiDisclosureText: e.target.value })} disabled={dis} /></Field>
        {!v.physicalAddress && <Alert tone="warning" title="Add a physical mailing address">Commercial-email laws in many jurisdictions require it in outreach.</Alert>}
      </Section>
      <Section title={`Suppression list (${d.suppressions.length})`} description="Emails and domains that can never be contacted. Unsubscribes and Do-Not-Contact leads are added automatically.">
        {!dis && <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await apiFetch("/api/settings/suppressions", { body: { value: sup } }); setSup(""); router.refresh(); } catch (err) { toast.error((err as Error).message); } }}><Input value={sup} onChange={(e) => setSup(e.target.value)} placeholder="name@example.com or @example.com" aria-label="Add suppression" /><Button type="submit" disabled={!sup}>Add</Button></form>}
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {d.suppressions.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Empty.</li>}
          {d.suppressions.map((s: any) => <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm"><span className="flex-1 font-mono text-xs">{s.value}</span><span className="text-xs text-muted">{s.reason} · {formatDateTime(s.createdAt)}</span>{can(d, "doNotContact.reverse") && <button className="text-faint hover:text-danger" aria-label={`Remove ${s.value}`} onClick={() => setRemoving(s.value)}><Trash2 className="h-3.5 w-3.5" /></button>}</li>)}
        </ul>
      </Section>
      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)} title={`Allow contacting ${removing}?`} description="Only if the contact explicitly opted back in. The justification is logged." footer={<><Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" disabled={why.trim().length < 10} onClick={async () => { try { await apiFetch("/api/settings/suppressions", { method: "DELETE", body: { value: removing, justification: why } }); setRemoving(null); setWhy(""); router.refresh(); } catch (e) { toast.error((e as Error).message); } }}>Remove from list</Button></>}>
        <Field label="Justification" htmlFor="why"><Textarea id="why" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

function Notifications({ d }: { d: D }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(d.notificationPrefs ?? {});
  const { save } = useSaver("/api/me/notifications");
  return (
    <Section title="Notifications" description="In-app notifications for this workspace.">
      <div className="divide-y divide-border">
        {Object.entries(d.notificationTypes as Record<string, string>).map(([k, l]) => <Switch key={k} label={l} checked={prefs[k] !== false} onChange={(x) => { const n = { ...prefs, [k]: x }; setPrefs(n); save(n, "Preferences saved"); }} />)}
      </div>
    </Section>
  );
}

function DataSettings({ d }: { d: D }) {
  const c = d.settings.compliance;
  const [days, setDays] = useState(c.dataRetentionDays);
  const { save, busy } = useSaver("/api/settings/compliance");
  return (
    <>
      <Section title="Export" description="Download your workspace leads as CSV (Business, Category, Address, Phone, Website, Email, Website Status/Score, Opportunity, Lead/Response Status, Campaign, Date Added). No secrets are ever exported.">
        {can(d, "leads.export") ? <a href="/api/leads/export?archived=all" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-subtle"><Download className="h-4 w-4" /> Export all leads (CSV)</a> : <p className="text-sm text-muted">Only admins can export.</p>}
      </Section>
      <Section title="Retention & deletion" description="Delete individual leads, conversations or campaigns from their pages (with confirmation). Bulk deletion requires typing the exact count. The workspace can be deleted under Workspace." footer={can(d, "compliance.manage") && <Button loading={busy} onClick={() => save({ dataRetentionDays: +days })}>Save</Button>}>
        <Field label="Google Places data refresh reminder (days)" htmlFor="ret" hint="Google's terms limit how long some Places content may be cached; 0 = off. Leads older than this show as needing refresh."><Input id="ret" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value as any)} disabled={!can(d, "compliance.manage")} /></Field>
        <p className="text-sm text-muted">Workspace contains {d.counts.leads} leads, {d.counts.conversations} conversations and {d.counts.campaigns} campaigns.</p>
      </Section>
    </>
  );
}

function Security({ d }: { d: D }) {
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <Section title="Sessions" description="Devices currently signed in to your account.">
        <ul className="divide-y divide-border rounded-xl border border-border">
          {d.sessions.map((s: any) => <li key={s.id} className="px-4 py-2.5 text-sm"><div className="truncate">{s.userAgent ?? "Unknown device"}</div><div className="text-xs text-muted">{s.ipAddress ?? "—"} · signed in {formatDateTime(s.createdAt)} · last active {timeAgo(s.lastUsedAt)}</div></li>)}
        </ul>
        <Button variant="outline" onClick={async () => { const r = await apiFetch<{ revoked: number }>("/api/me/sessions", { method: "DELETE" }); toast.success(`Signed out ${r.revoked} other session(s)`); router.refresh(); }}>Sign out other sessions</Button>
      </Section>
      <Section title="How your data is protected">
        <ul className="space-y-1.5 text-sm text-muted">
          <li>• API keys and OAuth tokens are encrypted with AES-256-GCM and never sent to the browser.</li>
          <li>• Sessions use HttpOnly, SameSite cookies; state-changing requests are origin-checked (CSRF).</li>
          <li>• Sign-in, sign-up and webhooks are rate limited.</li>
          <li>• Every query is scoped to your workspace and checked against your role.</li>
          <li>• Website audits refuse private-network addresses (SSRF protection) and respect robots.txt.</li>
          <li>• Important actions are recorded in the activity log (Admin → Logs).</li>
        </ul>
      </Section>
    </>
  );
}
