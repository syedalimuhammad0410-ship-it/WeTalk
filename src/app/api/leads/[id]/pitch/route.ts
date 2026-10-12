import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { buildCallScript, generateQuote } from "@/lib/server/pitch";
import { rateLimit } from "@/lib/server/ratelimit";

/** Call script for this lead (built from verified findings; no AI). */
export const GET = api({ permission: "emails.compose" }, async (_req, ctx, p) => buildCallScript(ctx.workspace.id, p.id!));

/** Requirements-based quote from the agency's configured pricing. */
export const POST = api({ permission: "emails.compose" }, async (req, ctx, p) => {
  await rateLimit(`quote:${ctx.workspace.id}`, 60, 3600, "Too many quotes this hour. Try again later.");
  const b = await parseBody(req, z.object({ requirements: z.string().max(3000).default("") }));
  return generateQuote(ctx.workspace.id, p.id!, b.requirements);
});
export const maxDuration = 120;
