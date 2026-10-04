import { api } from "@/lib/server/api";
import { globalSearch } from "@/lib/server/queries";

export const GET = api({}, async (req, ctx) => globalSearch(ctx.workspace.id, req.nextUrl.searchParams.get("q") ?? ""));
