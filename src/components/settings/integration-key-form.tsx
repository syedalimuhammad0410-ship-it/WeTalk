"use client";
import { useState } from "react";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form";
import { Badge } from "../ui/misc";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";

export function IntegrationKeyForm({ provider, status, disabled, onChange }: { provider: "anthropic" | "google-places"; status: { configured: boolean; source: string | null; hint: string | null; status?: string; lastError?: string | null }; disabled?: boolean; onChange?: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const name = provider === "anthropic" ? "Anthropic API key" : "Google Maps Platform API key";
  const env = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GOOGLE_MAPS_API_KEY";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-subtle/50 px-4 py-3 text-sm">
        <KeyRound className="h-4 w-4 text-muted" />
        <span className="font-medium">{name}</span>
        {status.configured ? (
          <Badge tone={status.status === "ERROR" ? "red" : "green"} dot>{status.status === "ERROR" ? "Error" : "Connected"} · {status.source === "server" ? "server environment" : status.hint}</Badge>
        ) : (
          <Badge tone="zinc">Not connected</Badge>
        )}
        {status.lastError && <span className="w-full text-xs text-danger">{status.lastError}</span>}
      </div>
      {!disabled && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("save");
            try {
              await apiFetch(`/api/settings/integrations/${provider}`, { method: "PUT", body: { key } });
              toast.success(`${name} saved`, "Connection test passed. The key is encrypted at rest and never shown again.");
              setKey("");
              onChange?.();
            } catch (err) {
              toast.error("Key not saved", (err as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          <Field label={status.configured ? "Replace key" : "API key"} htmlFor={`${provider}-key`} className="flex-1" hint={`Stored encrypted (AES-256-GCM). Or set ${env} on the server.`}>
            <Input id={`${provider}-key`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === "anthropic" ? "sk-ant-…" : "AIza…"} />
          </Field>
          <Button type="submit" loading={busy === "save"} loadingText="Testing…" disabled={key.trim().length < 8} className="sm:mb-5">
            Test & save
          </Button>
        </form>
      )}
      {status.configured && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={busy === "test"}
            onClick={async () => {
              setBusy("test");
              try {
                const r = await apiFetch<{ ok: boolean; error?: string }>(`/api/settings/integrations/${provider}/test`, { body: {} });
                if (r.ok) toast.success("Connection OK");
                else toast.error("Connection failed", r.error);
                onChange?.();
              } finally {
                setBusy(null);
              }
            }}
          >
            <CheckCircle2 className="h-4 w-4" /> Test connection
          </Button>
          {status.source === "workspace" && !disabled && (
            <Button
              variant="ghost"
              size="sm"
              loading={busy === "remove"}
              onClick={async () => {
                setBusy("remove");
                try {
                  await apiFetch(`/api/settings/integrations/${provider}`, { method: "DELETE" });
                  toast.success("Key removed");
                  onChange?.();
                } finally {
                  setBusy(null);
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Remove key
            </Button>
          )}
        </div>
      )}
      {disabled && <p className="text-xs text-muted">Only workspace owners and admins can change API settings.</p>}
    </div>
  );
}
