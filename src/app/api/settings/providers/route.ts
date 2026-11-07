import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { logActivity } from "@/lib/server/activity";
import { PROVIDER_IDS, providerOverview } from "@/lib/server/discovery/providers";

export const GET = api({ permission: "leads.view" }, async (_req, ctx) => ({ providers: await providerOverview(ctx.workspace.id) }));

const Body = z.object({ provider: z.enum(PROVIDER_IDS), enabled: z.boolean().optional(), dailyRequestLimit: z.coerce.number().int().min(0).max(100000).optional() });

export const PATCH = api({ permission: "integrations.manage" }, async (req, ctx) => {
  const b = await parseBody(req, Body);
  const data = { ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.dailyRequestLimit !== undefined ? { dailyRequestLimit: b.dailyRequestLimit } : {}) };
  await db.discoveryProviderSetting.upsert({ where: { workspaceId_provider: { workspaceId: ctx.workspace.id, provider: b.provider } }, create: { workspaceId: ctx.workspace.id, provider: b.provider, ...data }, update: data });
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "settings.provider_updated", summary: `Discovery provider ${b.provider}: ${JSON.stringify(data)}` });
  return { ok: true };
});
