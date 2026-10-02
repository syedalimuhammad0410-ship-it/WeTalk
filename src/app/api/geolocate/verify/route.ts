import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { verifyGeoGuess } from "@/lib/server/research";

const Body = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  region: z.string().max(120).nullish(),
  country: z.string().max(120).nullish(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  precision: z.string().max(20),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(1500),
  keyClues: z.array(z.string().max(200)).max(10).default([]),
  searchQuery: z.string().max(300).optional(),
  model: z.string().max(80),
  rank: z.number().int().min(0).max(10),
});

/** Checks one AI location hypothesis against map data and real web search results. */
export const POST = route(async (req, { user }) => verifyGeoGuess(await readJson(req, Body), await providerContext(user.email)), { limit: 60, name: "geolocate-verify" });
