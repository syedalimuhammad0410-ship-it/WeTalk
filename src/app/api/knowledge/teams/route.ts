import { HttpError, route } from "@/lib/server/api";
import { teamsForSport } from "@/lib/providers/wikidata";

/** Team lists per sport (Wikidata), used for in-browser CLIP zero-shot logo recognition. */
export const GET = route(async (req) => {
  const sport = req.nextUrl.searchParams.get("sport") || "";
  if (!/^(basketball|football|baseball|hockey|soccer)$/.test(sport)) throw new HttpError(400, "Unsupported sport.");
  const leagues = await teamsForSport(sport);
  return { sport, leagues };
}, { limit: 30, name: "teams" });
