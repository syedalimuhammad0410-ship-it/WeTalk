import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { generateQuoteEmail } from "@/lib/server/pitch";
import { rateLimit } from "@/lib/server/ratelimit";

/** Writes a detailed quote email (Basic / Professional / Premium from your price list) and saves it as a draft. Sending is a separate, confirmed step. */
export const POST = api({ permission: "emails.compose" }, async (req, ctx, p) => {
  await rateLimit(`quote:${ctx.workspace.id}`, 60, 3600, "Too many quotes this hour. Try again later.");
  const b = await parseBody(req, z.object({ requirements: z.string().max(3000).default("") }));
  return generateQuoteEmail(ctx.workspace.id, p.id!, b.requirements, ctx.user.id);
});
export const maxDuration = 120;
