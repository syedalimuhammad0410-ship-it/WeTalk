import { api } from "@/lib/server/api";
import { systemHealth } from "@/lib/server/health";

export const GET = api({}, async (req, ctx) => systemHealth(ctx.workspace.id, { live: req.nextUrl.searchParams.get("live") === "1" }));
