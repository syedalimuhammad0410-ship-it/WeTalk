import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { candidateImages } from "@/lib/server/research";
import { providerContext } from "@/lib/server/settings";

/** Reference photographs for a candidate (Wikimedia Commons; licensed, attributable). */
export const POST = route(async (req, { user }) => {
  const b = await readJson(
    req,
    z.object({ name: z.string().min(1).max(200), city: z.string().max(120).optional(), category: z.string().max(200).optional(), sceneHint: z.string().max(40).optional(), aliases: z.array(z.string().max(200)).max(10).optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), outdoor: z.boolean().optional() }),
  );
  const near = b.lat !== undefined && b.lng !== undefined ? { lat: b.lat, lng: b.lng, outdoor: b.outdoor !== false, ctx: await providerContext(user.email) } : undefined;
  return candidateImages(b.name, b.city, b.category, b.sceneHint, b.aliases, near);
}, { limit: 60, name: "candidate-images" });
