import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";

export const GET = api({}, async (_req, ctx) => db.tag.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { name: "asc" }, include: { _count: { select: { leads: true } } } }));

export const POST = api({ permission: "leads.edit" }, async (req, ctx) => {
  const b = await parseBody(req, z.object({ name: z.string().trim().min(1).max(40), color: z.string().max(20).default("slate") }));
  return db.tag.upsert({ where: { workspaceId_name: { workspaceId: ctx.workspace.id, name: b.name } }, create: { workspaceId: ctx.workspace.id, ...b }, update: { color: b.color } });
});
