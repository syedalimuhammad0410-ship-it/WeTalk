import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { runAssistant } from "@/lib/server/assistant/agent";
import { rateLimit } from "@/lib/server/ratelimit";

export const maxDuration = 300;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(40),
});

/** In-app AI assistant: answers questions and takes actions with the user's permissions. */
export const POST = api({}, async (req, ctx) => {
  await rateLimit(`assistant:${ctx.user.id}`, 60, 3600);
  const { messages } = await parseBody(req, Body);
  if (messages[messages.length - 1]!.role !== "user") return { reply: "Ask me something to get started.", steps: [], pending: null, changed: false };
  return runAssistant(ctx, messages);
});
