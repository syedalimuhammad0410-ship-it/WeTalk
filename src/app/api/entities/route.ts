import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { providerContext } from "@/lib/server/settings";
import { resolveEntities } from "@/lib/server/research";

const Text = z.object({ text: z.string().max(300), confidence: z.number().min(0).max(100), origin: z.enum(["ocr", "ai", "cloud-vision", "user", "logo"]), clueId: z.string().max(64).optional() });

const Body = z.object({
  texts: z.array(Text).max(200),
  sceneHints: z.array(z.string().max(40)).max(20),
  aiEntities: z.array(z.object({ name: z.string().max(200), type: z.string().max(60) })).max(60).optional(),
  logos: z.array(z.object({ name: z.string().max(200), confidence: z.number().min(0).max(1), clueId: z.string().max(64).optional() })).max(30).optional(),
  landmarks: z.array(z.object({ name: z.string().max(200), lat: z.number().optional(), lng: z.number().optional(), score: z.number() })).max(10).optional(),
  mode: z.string().max(30),
  maxLookups: z.number().int().min(1).max(14).optional(),
  officialOnly: z.boolean().optional(),
});

/** Entity extraction + resolution against Wikipedia/Wikidata. */
export const POST = route(async (req, { user }) => resolveEntities(await readJson(req, Body), await providerContext(user.email)), { limit: 40, name: "entities" });
