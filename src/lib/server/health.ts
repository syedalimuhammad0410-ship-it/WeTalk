import "./guard";
import type { IntegrationProvider } from "@prisma/client";
import { db } from "../db";
import { describeError, fetchWithTimeout } from "./errors";
import { testAnthropicKey } from "./ai/client";
import { resolveIntegrationKey } from "./workspace";
import { env } from "./env";

let testOverride: ((p: IntegrationProvider, key: string) => Promise<{ ok: boolean; error?: string }>) | null = null;
export function setIntegrationTestOverride(fn: typeof testOverride) {
  testOverride = fn;
}

export async function testIntegration(workspaceId: string, provider: IntegrationProvider, key: string): Promise<{ ok: boolean; error?: string }> {
  if (testOverride) return testOverride(provider, key);
  if (provider === "ANTHROPIC") {
    const s = await db.automationSettings.findUnique({ where: { workspaceId } });
    return testAnthropicKey(key, s?.aiModel ?? "claude-opus-5-5");
  }
  try {
    const res = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
      service: "Google Places API",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: "coffee in Toronto", pageSize: 1 }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, error: `${res.status}: ${data.error?.message ?? "request failed"}` };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

export type HealthItem = { name: string; status: "ok" | "warning" | "error" | "off"; detail: string; action?: string; href?: string };

export async function systemHealth(workspaceId: string, opts: { live?: boolean } = {}): Promise<HealthItem[]> {
  const items: HealthItem[] = [];
  try {
    const t = Date.now();
    await db.$queryRaw`SELECT 1`;
    items.push({ name: "Database", status: "ok", detail: `Connected (${Date.now() - t} ms)` });
  } catch (e) {
    items.push({ name: "Database", status: "error", detail: describeError(e), action: "Check DATABASE_URL and that PostgreSQL is reachable." });
  }
  if (!env.encryptionKey() || env.encryptionKey().length < 32) items.push({ name: "Encryption key", status: "error", detail: "APP_ENCRYPTION_KEY is missing or too short — credentials cannot be stored.", action: "Set a 32+ character APP_ENCRYPTION_KEY." });

  for (const [prov, name, href] of [["ANTHROPIC", "AI (Anthropic)", "/settings/integrations"], ["GOOGLE_PLACES", "Business discovery (Google Places)", "/settings/integrations"]] as const) {
    const key = await resolveIntegrationKey(workspaceId, prov).catch(() => null);
    const cred = await db.integrationCredential.findUnique({ where: { workspaceId_provider: { workspaceId, provider: prov } } });
    if (!key) {
      items.push({ name, status: "off", detail: "Not connected", action: `Add a ${prov === "ANTHROPIC" ? "Anthropic API key" : "Google Maps Platform API key with Places API (New) enabled"}.`, href });
      continue;
    }
    if (opts.live) {
      const r = await testIntegration(workspaceId, prov, key.key);
      items.push({ name, status: r.ok ? "ok" : "error", detail: r.ok ? `Connected (${key.source === "server" ? "server key" : "workspace key"})` : r.error ?? "Failed", action: r.ok ? undefined : "Update the API key or check quota/billing.", href });
    } else if (cred?.status === "ERROR") {
      items.push({ name, status: "error", detail: cred.lastError ?? "Last request failed", action: "Re-test or replace the key.", href });
    } else items.push({ name, status: "ok", detail: `Configured (${key.source === "server" ? "server key" : "workspace key"})${cred?.lastCheckedAt ? ` · last used ${cred.lastCheckedAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}`, href });
  }

  const accounts = await db.emailAccount.findMany({ where: { workspaceId } });
  if (!accounts.length) items.push({ name: "Email", status: "off", detail: "No email account connected", action: "Connect Gmail or Postmark to send and receive email.", href: "/settings/email" });
  for (const a of accounts) {
    items.push({
      name: `Email (${a.provider === "SANDBOX" ? "SANDBOX" : a.provider.toLowerCase()}: ${a.emailAddress})`,
      status: a.status === "ERROR" ? "error" : a.provider === "SANDBOX" ? "warning" : "ok",
      detail: a.status === "ERROR" ? a.lastError ?? "Error" : a.provider === "SANDBOX" ? "Sandbox — emails are recorded but NOT delivered" : `Connected${a.lastSyncAt ? ` · last sync ${a.lastSyncAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}`,
      action: a.status === "ERROR" ? "Reconnect this account." : undefined,
      href: "/settings/email",
    });
  }

  const [failed, stuck, queued] = await Promise.all([
    db.job.count({ where: { workspaceId, status: "FAILED", finishedAt: { gte: new Date(Date.now() - 86400_000) } } }),
    db.job.count({ where: { workspaceId, status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
    db.job.findFirst({ where: { workspaceId, status: "QUEUED" }, orderBy: { createdAt: "asc" } }),
  ]);
  const backlog = queued && Date.now() - queued.createdAt.getTime() > 5 * 60_000;
  items.push({
    name: "Background jobs",
    status: stuck || backlog ? "error" : failed ? "warning" : "ok",
    detail: stuck ? `${stuck} job(s) appear stuck` : backlog ? "Jobs are queued but not being processed" : failed ? `Healthy · ${failed} failed in the last 24h` : `Healthy (${env.jobRunner()} runner)`,
    action: stuck || backlog ? (env.jobRunner() === "external" ? "Start the worker: npm run worker" : "Restart the web server process.") : failed ? "Review failed jobs below." : undefined,
  });
  return items;
}
