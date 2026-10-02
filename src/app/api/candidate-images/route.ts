import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { candidateImages } from "@/lib/server/research";

/** Reference photographs for a candidate (Wikimedia Commons; licensed, attributable). */
export const POST = route(async (req) => {
  const b = await readJson(req, z.object({ name: z.string().min(1).max(200), city: z.string().max(120).optional(), category: z.string().max(200).optional(), sceneHint: z.string().max(40).optional(), aliases: z.array(z.string().max(200)).max(10).optional() }));
  return candidateImages(b.name, b.city, b.category, b.sceneHint, b.aliases);
}, { limit: 60, name: "candidate-images" });
