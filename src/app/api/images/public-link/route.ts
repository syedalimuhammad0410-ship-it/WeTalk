import { SignJWT } from "jose";
import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";

/**
 * Temporary (30 min), unguessable public link to one of the user's images, created only when the
 * user explicitly asks to run a reverse image search on an outside site (Google Lens, Bing, Yandex, TinEye).
 */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, z.object({ imageKey: z.string().max(200) }));
  if (!ownsImageKey(user.email, b.imageKey)) throw new HttpError(404, "Image not found.");
  const token = await new SignJWT({ key: b.imageKey })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("trace")
    .setAudience("trace-public-image")
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  const origin = req.nextUrl.origin;
  return { url: `${origin}/api/public-image/${token}`, expiresInMinutes: 30 };
}, { limit: 30, name: "public-link" });
