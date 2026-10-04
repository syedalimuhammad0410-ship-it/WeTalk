import { api } from "@/lib/server/api";
import { analytics } from "@/lib/server/queries";

export const GET = api({}, async (req, ctx) => {
  const to = req.nextUrl.searchParams.get("to") ? new Date(req.nextUrl.searchParams.get("to")!) : new Date();
  const from = req.nextUrl.searchParams.get("from") ? new Date(req.nextUrl.searchParams.get("from")!) : new Date(to.getTime() - 30 * 86400_000);
  return analytics(ctx.workspace.id, from, to);
});
