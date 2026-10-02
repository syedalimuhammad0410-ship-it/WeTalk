import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { SECRET_KEYS, secretStatus, setSecret } from "@/lib/server/settings";

/** Store or clear a user-supplied API key (encrypted at rest; never returned to the browser). */
export const PUT = route(async (req, { user }) => {
  const b = await readJson(req, z.object({ key: z.enum(SECRET_KEYS), value: z.string().max(400).nullable() }));
  await setSecret(user.email, b.key, b.value && b.value.trim() ? b.value.trim() : null);
  return { keys: await secretStatus(user.email) };
}, { limit: 20, name: "keys" });
