import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { createConnection } from "@/lib/server/claude/connections";
import { rateLimit } from "@/lib/server/ratelimit";

/** Creates a connection and returns its secret link once. */
export const POST = api({ permission: "integrations.manage" }, async (req, ctx) => {
  await rateLimit(`claude-conn:${ctx.workspace.id}`, 20, 3600, "Too many new connections this hour.");
  const b = await parseBody(req, z.object({ name: z.string().trim().max(60).default("Claude") }));
  return createConnection(ctx.workspace.id, ctx.user.id, b.name);
});
