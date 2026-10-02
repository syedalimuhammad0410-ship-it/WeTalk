import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { getPrefs, savePrefs, secretStatus } from "@/lib/server/settings";
import { storage } from "@/lib/server/storage";

const Prefs = z.object({
  aiModel: z.string().regex(/^claude-[a-z0-9-]+$/).max(60),
  aiEnabled: z.boolean(),
  webProvider: z.enum(["auto", "brave", "tavily", "wikipedia"]),
  mapProvider: z.enum(["osm", "google"]),
  ocrProvider: z.enum(["tesseract", "google-vision"]),
  imageSearchProvider: z.enum(["commons", "serpapi-lens"]),
  animation: z.enum(["full", "reduced", "off"]),
  maxQueriesQuick: z.number().int().min(4).max(40),
  maxQueriesDeep: z.number().int().min(8).max(120),
  retentionDays: z.number().int().min(0).max(3650),
  officialSourcesOnly: z.boolean(),
  debug: z.boolean(),
}).partial();

export const GET = route(async (_req, { user }) => ({
  prefs: await getPrefs(user.email),
  keys: await secretStatus(user.email),
  storage: storage().name,
  publicConfig: { googleMapsBrowserKey: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY) },
}));

export const PUT = route(async (req, { user }) => ({ prefs: await savePrefs(user.email, await readJson(req, Prefs)) }), { limit: 30, name: "settings" });
