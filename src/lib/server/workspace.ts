import "./guard";
import type { IntegrationProvider, Prisma } from "@prisma/client";
import { db } from "../db";
import { decryptSecret, encryptSecret, secretHint } from "./crypto";
import { env } from "./env";
import { AppError } from "./errors";

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 40) || "workspace"
  );
}

export const DEFAULT_TEMPLATES: { name: string; kind: "OUTREACH" | "FOLLOW_UP" | "REPLY"; subject: string; body: string }[] = [
  {
    name: "Website idea — observation led",
    kind: "OUTREACH",
    subject: "A website idea for {{business_name}}",
    body: `Hi {{contact_name}},

I was looking at {{business_name}}'s online presence in {{city}} and noticed one specific thing: {{top_issue}}.

For a business like yours, {{top_opportunity}} could make it easier for visitors to take the next step.

I put together a few concrete ideas on what an improved site could include. Would it be useful if I sent them over? No pressure either way.

Best,
{{sender_name}}
{{company_name}}`,
  },
  {
    name: "Gentle follow-up",
    kind: "FOLLOW_UP",
    subject: "Re: A website idea for {{business_name}}",
    body: `Hi {{contact_name}},

Just following up on my note about {{business_name}}'s website. Happy to share the specific ideas I mentioned — or if the timing isn't right, no problem at all.

Best,
{{sender_name}}`,
  },
  {
    name: "Final follow-up",
    kind: "FOLLOW_UP",
    subject: "Re: A website idea for {{business_name}}",
    body: `Hi {{contact_name}},

I'll close the loop here so I don't clutter your inbox. If improving the website becomes a priority later, feel free to reply any time.

All the best,
{{sender_name}}`,
  },
];

/** Creates a workspace with all default settings rows and makes the user its OWNER. */
export async function createWorkspace(userId: string, name: string, opts: { isDemo?: boolean } = {}) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await db.workspace.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  const ws = await db.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: {
        name: name.trim(),
        slug,
        isDemo: opts.isDemo ?? false,
        members: { create: { userId, role: "OWNER" } },
        companyProfile: { create: {} },
        automation: { create: {} },
        compliance: { create: {} },
        templates: { create: DEFAULT_TEMPLATES },
      },
    });
    await tx.user.update({ where: { id: userId }, data: { lastWorkspaceId: ws.id } });
    await tx.activityLog.create({
      data: { workspaceId: ws.id, userId, action: "workspace.created", summary: `Created workspace “${ws.name}”` },
    });
    return ws;
  });
  return ws;
}

export async function getSettings(workspaceId: string) {
  const [automation, compliance, company] = await Promise.all([
    db.automationSettings.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
    db.complianceSettings.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
    db.companyProfile.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
  ]);
  return { automation, compliance, company };
}

// ───────────── Integration credentials (never returned to clients) ─────────────

export async function saveIntegrationKey(workspaceId: string, provider: IntegrationProvider, secret: string) {
  const trimmed = secret.trim();
  if (trimmed.length < 8) throw new AppError("VALIDATION", "That key looks too short.");
  return db.integrationCredential.upsert({
    where: { workspaceId_provider: { workspaceId, provider } },
    create: { workspaceId, provider, secretEncrypted: encryptSecret(trimmed), secretHint: secretHint(trimmed) },
    update: { secretEncrypted: encryptSecret(trimmed), secretHint: secretHint(trimmed), status: "CONNECTED", lastError: null },
  });
}

export async function removeIntegrationKey(workspaceId: string, provider: IntegrationProvider) {
  await db.integrationCredential.deleteMany({ where: { workspaceId, provider } });
}

/** Returns the usable key: workspace key first, then server env default. */
export async function resolveIntegrationKey(workspaceId: string, provider: IntegrationProvider): Promise<{ key: string; source: "workspace" | "server" } | null> {
  const cred = await db.integrationCredential.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  if (cred) return { key: decryptSecret(cred.secretEncrypted), source: "workspace" };
  const fromEnv = provider === "ANTHROPIC" ? env.anthropicKey() : env.googleMapsKey();
  return fromEnv ? { key: fromEnv, source: "server" } : null;
}

export async function markIntegration(workspaceId: string, provider: IntegrationProvider, ok: boolean, error?: string) {
  await db.integrationCredential.updateMany({
    where: { workspaceId, provider },
    data: { status: ok ? "CONNECTED" : "ERROR", lastCheckedAt: new Date(), lastError: ok ? null : (error ?? "Unknown error").slice(0, 500) },
  });
}

export async function integrationSummary(workspaceId: string) {
  const creds = await db.integrationCredential.findMany({ where: { workspaceId } });
  const byProvider = (p: IntegrationProvider) => creds.find((c) => c.provider === p);
  const describe = (p: IntegrationProvider, envSet: boolean) => {
    const c = byProvider(p);
    if (c) return { configured: true, source: "workspace" as const, hint: c.secretHint, status: c.status, lastError: c.lastError, lastCheckedAt: c.lastCheckedAt };
    if (envSet) return { configured: true, source: "server" as const, hint: "Server environment", status: "CONNECTED" as const, lastError: null, lastCheckedAt: null };
    return { configured: false, source: null, hint: null, status: "DISCONNECTED" as const, lastError: null, lastCheckedAt: null };
  };
  const accounts = await db.emailAccount.findMany({
    where: { workspaceId },
    select: { id: true, provider: true, emailAddress: true, displayName: true, status: true, lastError: true, lastSyncAt: true, isDefault: true, replyTo: true, signature: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    anthropic: describe("ANTHROPIC", Boolean(env.anthropicKey())),
    googlePlaces: describe("GOOGLE_PLACES", Boolean(env.googleMapsKey())),
    email: accounts,
    googleOAuthAvailable: env.googleOAuthConfigured(),
    sandboxAvailable: env.sandboxEmailEnabled(),
  };
}

export type JsonValue = Prisma.InputJsonValue;
