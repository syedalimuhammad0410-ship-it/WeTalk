import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { mapProvider, nominatim } from "@/lib/providers/maps";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("geocode"), q: z.string().min(2).max(300) }),
  z.object({ op: z.literal("places"), q: z.string().min(2).max(300), lat: z.number().optional(), lng: z.number().optional(), radiusKm: z.number().max(200).optional() }),
  z.object({ op: z.literal("reverse"), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  z.object({ op: z.literal("nearby"), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().min(50).max(2000).optional() }),
]);

/** MapProvider operations: geocode, searchPlaces, reverse (details), nearby landmarks. */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, Body);
  const maps = mapProvider(await providerContext(user.email));
  switch (b.op) {
    case "geocode":
      return maps.geocode(b.q, 6);
    case "places":
      return maps.searchPlaces(b.q, b.lat !== undefined && b.lng !== undefined ? { lat: b.lat, lng: b.lng, radiusKm: b.radiusKm } : undefined, 8);
    case "reverse":
      return maps.reverse(b.lat, b.lng);
    case "nearby":
      return (maps.nearby || nominatim.nearby!)(b.lat, b.lng, b.radiusM);
  }
}, { limit: 60, name: "maps" });
