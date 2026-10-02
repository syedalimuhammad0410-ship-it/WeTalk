import { HttpError, route } from "@/lib/server/api";
import { getInvestigation } from "@/lib/server/investigations";

/** All sources for an investigation, grouped by category. */
export const GET = route(async (req, { user }) => {
  const id = req.nextUrl.searchParams.get("investigationId");
  if (!id) throw new HttpError(400, "investigationId required.");
  const inv = await getInvestigation(user.email, id);
  const groups: Record<string, typeof inv.sources> = {};
  for (const s of inv.sources) (groups[s.category] ||= []).push(s);
  return { total: inv.sources.length, used: inv.sources.filter((s) => s.usedInReasoning).length, groups };
});
