import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { savePromptEdit } from "@/lib/server/prompts/service";

export const GET = api({}, async (_req, ctx, p) => {
  const prompt = await db.generatedPrompt.findFirst({
    where: { id: p.id, workspaceId: ctx.workspace.id },
    include: { versions: { orderBy: { version: "desc" } }, business: { select: { id: true, name: true } } },
  });
  if (!prompt) throw new AppError("NOT_FOUND", "Prompt not found.");
  return prompt;
});

export const PUT = api({ permission: "prompts.edit" }, async (req, ctx, p) => {
  const { content } = await parseBody(req, z.object({ content: z.string().max(400_000) }));
  const r = await savePromptEdit(ctx.workspace.id, p.id!, content, ctx.user.id);
  return { version: r.version, quality: "quality" in r ? r.quality?.score : undefined, unchanged: "unchanged" in r };
});

export const DELETE = api({ permission: "leads.delete" }, async (_req, ctx, p) => {
  const prompt = await db.generatedPrompt.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!prompt) throw new AppError("NOT_FOUND", "Prompt not found.");
  await db.generatedPrompt.delete({ where: { id: prompt.id } });
  return { ok: true };
});
