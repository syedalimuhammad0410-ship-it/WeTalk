import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { resolveIntegrationKey, markIntegration } from "@/lib/server/workspace";
import { testIntegration } from "@/lib/server/health";

export const POST = api({}, async (_req, ctx, p) => {
  const prov = ({ anthropic: "ANTHROPIC", "google-places": "GOOGLE_PLACES" } as const)[p.provider as "anthropic" | "google-places"];
  if (!prov) throw new AppError("NOT_FOUND", "Unknown integration.");
  const key = await resolveIntegrationKey(ctx.workspace.id, prov);
  if (!key) return { ok: false, error: "Not configured" };
  const r = await testIntegration(ctx.workspace.id, prov, key.key);
  if (key.source === "workspace") await markIntegration(ctx.workspace.id, prov, r.ok, r.error);
  return r;
});
