import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { buildDossier } from "@/lib/server/dossier";

const KINDS = ["company", "airline", "brand", "organization", "sports team", "landmark", "place", "product", "vehicle", "meme", "artwork", "event", "other"] as const;

/** Builds a sourced profile (facts, financials, people, codes, news) of one subject seen in the image. */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, z.object({ name: z.string().min(1).max(160), kind: z.enum(KINDS).catch("other"), wikidataId: z.string().max(20).optional(), foundBecause: z.string().max(300).default("") }));
  return buildDossier(b, await providerContext(user.email));
}, { limit: 40, name: "dossier" });
