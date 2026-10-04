"use client";
import { useState } from "react";
import { Copy, FlaskConical, Mail, Send } from "lucide-react";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form";
import { Alert, Badge } from "../ui/misc";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

type Props = {
  integrations: { email: { id: string; provider: string; emailAddress: string; status: string }[]; googleOAuthAvailable: boolean; sandboxAvailable: boolean };
  disabled?: boolean;
  onChange?: () => void;
};

export function EmailConnect({ integrations, disabled, onChange }: Props) {
  const toast = useToast();
  const [mode, setMode] = useState<null | "postmark" | "sandbox">(null);
  const [form, setForm] = useState({ emailAddress: "", displayName: "", serverToken: "", inboundAddress: "" });
  const [busy, setBusy] = useState(false);
  const [webhook, setWebhook] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(provider: "POSTMARK" | "SANDBOX") {
    setBusy(true);
    try {
      const r = await apiFetch<{ inboundWebhookUrl: string | null }>("/api/email-accounts", { body: provider === "SANDBOX" ? { provider, emailAddress: form.emailAddress, displayName: form.displayName } : { provider, ...form } });
      toast.success(provider === "SANDBOX" ? "Sandbox connected" : "Postmark connected");
      setMode(null);
      if (r.inboundWebhookUrl) setWebhook(r.inboundWebhookUrl);
      onChange?.();
    } catch (e) {
      toast.error("Could not connect", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {integrations.email.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {integrations.email.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              {a.provider === "SANDBOX" ? <FlaskConical className="h-4 w-4 text-sky-500" /> : <Mail className="h-4 w-4 text-muted" />}
              <span className="min-w-0 flex-1 truncate font-medium">{a.emailAddress}</span>
              <Badge tone={a.provider === "SANDBOX" ? "sky" : "slate"}>{a.provider === "SANDBOX" ? "SANDBOX" : a.provider === "GMAIL" ? "Gmail" : "Postmark"}</Badge>
              <Badge tone={a.status === "ERROR" ? "red" : "green"} dot>{a.status === "ERROR" ? "Error" : "Connected"}</Badge>
            </li>
          ))}
        </ul>
      )}
      {webhook && (
        <Alert tone="success" title="Set this as your Postmark inbound webhook URL">
          <span className="mt-1 flex items-center gap-2 break-all font-mono text-xs">{webhook}</span>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { navigator.clipboard.writeText(webhook); toast.success("Copied"); }}><Copy className="h-3.5 w-3.5" /> Copy URL</Button>
          <span className="mt-1 block text-xs">This URL is shown once. It contains a secret token.</span>
        </Alert>
      )}
      {!disabled && (
        <div className="grid gap-3 sm:grid-cols-3">
          {integrations.googleOAuthAvailable ? (
            <a href="/api/auth/google?purpose=gmail" className="rounded-xl border border-border p-4 text-left transition-colors hover:bg-subtle">
              <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4" /> Gmail</div>
              <p className="mt-1 text-xs text-muted">Secure Google OAuth. Sends from your mailbox and detects replies automatically.</p>
            </a>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-4 text-left opacity-80">
              <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4" /> Gmail</div>
              <p className="mt-1 text-xs text-muted">Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server (see Help → Email setup).</p>
            </div>
          )}
          <button onClick={() => setMode("postmark")} className="rounded-xl border border-border p-4 text-left transition-colors hover:bg-subtle">
            <div className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4" /> Postmark</div>
            <p className="mt-1 text-xs text-muted">Server API token for sending + inbound webhook for replies.</p>
          </button>
          {integrations.sandboxAvailable && (
            <button onClick={() => setMode("sandbox")} className="rounded-xl border border-dashed border-sky-500/40 p-4 text-left transition-colors hover:bg-sky-500/5">
              <div className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4 text-sky-500" /> Sandbox</div>
              <p className="mt-1 text-xs text-muted">Nothing is delivered. Simulate replies to test workflows.</p>
            </button>
          )}
        </div>
      )}
      {disabled && <p className="text-xs text-muted">Only workspace owners and admins can connect email accounts.</p>}
      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === "postmark" ? "Connect Postmark" : "Connect email sandbox"}
        description={mode === "postmark" ? "Use a Postmark server with a verified sender signature or domain." : "SANDBOX: emails are stored in WebScout but never delivered to anyone."}
        footer={
          <>
            <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => create(mode === "postmark" ? "POSTMARK" : "SANDBOX")}>Connect</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="From address" htmlFor="ea" required hint={mode === "postmark" ? "Must be a verified sender in Postmark." : "Any address — e.g. you@yourstudio.com."}><Input id="ea" type="email" value={form.emailAddress} onChange={set("emailAddress")} data-autofocus /></Field>
          <Field label="Display name" htmlFor="dn"><Input id="dn" value={form.displayName} onChange={set("displayName")} placeholder="Alex at Pixel & Pine" /></Field>
          {mode === "postmark" && (
            <>
              <Field label="Server API token" htmlFor="st" required hint="Stored encrypted. Never shown again."><Input id="st" type="password" autoComplete="off" value={form.serverToken} onChange={set("serverToken")} /></Field>
              <Field label="Postmark inbound address (optional)" htmlFor="ia" hint="e.g. abc123@inbound.postmarkapp.com — replies are routed back with a per-conversation tracking hash for exact matching."><Input id="ia" type="email" value={form.inboundAddress} onChange={set("inboundAddress")} /></Field>
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}
