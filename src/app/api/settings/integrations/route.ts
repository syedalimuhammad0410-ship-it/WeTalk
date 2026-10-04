import { api } from "@/lib/server/api";
import { integrationSummary } from "@/lib/server/workspace";

export const GET = api({}, async (_req, ctx) => integrationSummary(ctx.workspace.id));
