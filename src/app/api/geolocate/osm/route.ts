import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { osmComboPlan, osmComboResults } from "@/lib/server/research";

const Feature = z.object({ tags: z.record(z.string().max(40), z.string().max(80)).optional(), name: z.string().max(80).optional(), label: z.string().max(120) });
const Plan = z.object({ op: z.literal("plan"), area: z.string().min(2).max(160), anchor: Feature, near: z.array(Feature).max(3).default([]), radiusM: z.number().min(20).max(500).default(150) });
const Element = z.object({
  type: z.string().max(10),
  id: z.number(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  center: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  tags: z.record(z.string().max(60), z.string().max(300)).optional(),
});
const Results = z.object({ op: z.literal("results"), label: z.string().max(400), radiusM: z.number().min(20).max(500), area: z.string().max(160), anchorLabel: z.string().max(120), elements: z.array(Element).max(60) });

/**
 * Clue-combination map search. The Overpass query itself runs in the user's browser (Overpass allows
 * CORS and rations query slots per IP, which shared serverless IPs exhaust); the server plans the query
 * and turns the matches into evidence.
 */
export const POST = route(async (req) => {
  const b = await readJson(req, z.discriminatedUnion("op", [Plan, Results]));
  if (b.op === "plan") return osmComboPlan(b);
  return osmComboResults(b, b.elements);
}, { limit: 30, name: "geolocate-osm" });
