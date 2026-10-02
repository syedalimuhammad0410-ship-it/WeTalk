import { HttpError, route } from "@/lib/server/api";
import { ownsImageKey } from "@/lib/server/investigations";
import { storage } from "@/lib/server/storage";

export const GET = route<{ key: string[] }>(async (_req, { user, params }) => {
  const key = params.key.map(decodeURIComponent).join("/");
  if (!ownsImageKey(user.email, key)) throw new HttpError(404, "Not found.");
  const bin = await storage().getBinary(key);
  if (!bin) throw new HttpError(404, "Not found.");
  return new Response(bin.data, {
    headers: {
      "Content-Type": bin.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}, { limit: 600, name: "image-get" });
