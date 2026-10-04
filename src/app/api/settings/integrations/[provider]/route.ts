import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { removeIntegrationKey, saveIntegrationKey } from "@/lib/server/workspace";
import { logActivity } from "@/lib/server/activity";
import { testIntegration } from "@/lib/server/health";

const provider = (p: string) => {
  const v = { anthropic: "ANTHROPIC", "google-places": "GOOGLE_PLACES" }[p] as "ANTHROPIC" | "GOOGLE_PLACES" | undefined;
  if (!v) throw new AppError("NOT_FOUND", "Unknown integration.");
  return v;
};

export const PUT = api({ permission: "integrations.manage" }, async (req, ctx, p) => {
  const prov = provider(p.provider!);
  const { key } = await parseBody(req, z.object({ key: z.string().trim().min(8).max(500) }));
  const test = await testIntegration(ctx.workspace.id, prov, key);
  if (!test.ok) throw new AppError("INVALID_CREDENTIALS", `Key not saved — the connection test failed: ${test.error}`);
  await saveIntegrationKey(ctx.workspace.id, prov, key);
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.connected", summary: `${prov === "ANTHROPIC" ? "Anthropic" : "Google Places"} API key saved` });
  return { ok: true };
});

export const DELETE = api({ permission: "integrations.manage" }, async (_req, ctx, p) => {
  const prov = provider(p.provider!);
  await removeIntegrationKey(ctx.workspace.id, prov);
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.removed", summary: `${prov === "ANTHROPIC" ? "Anthropic" : "Google Places"} API key removed` });
  return { ok: true };
});
