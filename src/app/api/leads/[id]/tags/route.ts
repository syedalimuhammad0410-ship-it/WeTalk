import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { getLeadOrThrow } from "@/lib/server/leads";

/** Replaces the lead's tags. Unknown tag names are created. */
export const PUT = api({ permission: "leads.edit" }, async (req, ctx, p) => {
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  const { names } = await parseBody(req, z.object({ names: z.array(z.string().trim().min(1).max(40)).max(30) }));
  const unique = Array.from(new Set(names.map((n) => n.trim())));
  const tags = await Promise.all(unique.map((name) => db.tag.upsert({ where: { workspaceId_name: { workspaceId: ctx.workspace.id, name } }, create: { workspaceId: ctx.workspace.id, name }, update: {} })));
  await db.$transaction([db.leadTag.deleteMany({ where: { businessId: lead.id } }), db.leadTag.createMany({ data: tags.map((t) => ({ businessId: lead.id, tagId: t.id })) })]);
  return { tags };
});
