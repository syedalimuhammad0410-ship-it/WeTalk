import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";
import { loadBase64 } from "@/lib/server/image-load";
import { providerContext } from "@/lib/server/settings";
import { aiProvider } from "@/lib/providers/ai";

const Body = z.object({
  imageKeys: z.array(z.string().max(200)).min(1).max(3),
  clues: z.string().max(8000).default(""),
});

/** AI geolocation: ranked location hypotheses for the image(s). Each one is then checked via /api/geolocate/verify. */
export const POST = route(async (req, { user }) => {
  const body = await readJson(req, Body);
  if (!body.imageKeys.every((k) => ownsImageKey(user.email, k))) throw new HttpError(404, "Image not found.");
  const ai = aiProvider(await providerContext(user.email));
  if (!ai.configured()) return { status: "not_configured" as const, error: "AI geolocation needs GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.", locations: [], overall: "", model: "" };
  const imgs = await Promise.all(body.imageKeys.map((k) => loadBase64(k)));
  try {
    const r = await ai.geolocate(imgs.map((i) => ({ base64: i.base64, mime: i.mime })), body.clues);
    return { status: "ok" as const, ...r, locations: r.locations.slice(0, 5), model: ai.id === "gemini" ? `gemini:${ai.model}` : ai.model };
  } catch (e) {
    return { status: "error" as const, error: e instanceof Error ? e.message : String(e), locations: [], overall: "", model: "" };
  }
}, { limit: 30, name: "geolocate" });
