import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";

export const GET = api({}, async (req, ctx, p) => {
  const v = Number(req.nextUrl.searchParams.get("version")) || undefined;
  const prompt = await db.generatedPrompt.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id }, include: { business: { select: { name: true } } } });
  if (!prompt) throw new AppError("NOT_FOUND", "Prompt not found.");
  const version = await db.promptVersion.findUnique({ where: { promptId_version: { promptId: prompt.id, version: v ?? prompt.currentVersion } } });
  if (!version) throw new AppError("NOT_FOUND", "Version not found.");
  const slug = prompt.business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);
  return new NextResponse(version.content, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-website-prompt-v${version.version}.md"`, "Cache-Control": "no-store" },
  });
});
