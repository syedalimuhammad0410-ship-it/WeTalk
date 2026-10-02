import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";
import { loadBase64 } from "@/lib/server/image-load";
import { providerContext } from "@/lib/server/settings";
import { aiProvider } from "@/lib/providers/ai";
import { cloudVision } from "@/lib/providers/vision";

const Body = z.object({
  imageKey: z.string().max(200),
  width: z.number().int().min(0).max(20000).optional(),
  height: z.number().int().min(0).max(20000).optional(),
  mode: z.string().max(30).default("deep"),
  focus: z.string().max(300).optional(),
  instructions: z.string().max(2000).optional(),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) }).optional(),
  providers: z.array(z.enum(["ai", "cloud-vision"])).default(["ai", "cloud-vision"]),
});

/** Server-side multimodal analysis (Claude vision + Google Cloud Vision) where configured. */
export const POST = route(async (req, { user }) => {
  const body = await readJson(req, Body);
  if (!ownsImageKey(user.email, body.imageKey)) throw new HttpError(404, "Image not found.");
  const ctx = await providerContext(user.email);
  const ai = aiProvider(ctx);
  const img = await loadBase64(body.imageKey, body.region);
  const [aiRes, cloud] = await Promise.all([
    body.providers.includes("ai") && ai.configured()
      ? ai
          .analyzeImage({ base64: img.base64, mime: img.mime }, { mode: body.mode, focus: body.focus, instructions: body.instructions })
          .then((r) => ({ status: "ok" as const, result: r }))
          .catch((e) => ({ status: "error" as const, error: e instanceof Error ? e.message : String(e) }))
      : Promise.resolve({ status: "not_configured" as const, error: "AI vision is not configured (ANTHROPIC_API_KEY)." }),
    body.providers.includes("cloud-vision")
      ? cloudVision(ctx, img.base64, img.width || body.width || 0, img.height || body.height || 0)
      : Promise.resolve(null),
  ]);
  return { ai: aiRes, cloud, region: body.region || null };
}, { limit: 30, name: "analyze" });
