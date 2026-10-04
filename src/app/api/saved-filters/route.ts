import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";

export const GET = api({}, async (_req, ctx) => db.savedFilter.findMany({ where: { workspaceId: ctx.workspace.id, OR: [{ shared: true }, { userId: ctx.user.id }] }, orderBy: { name: "asc" } }));

export const POST = api({}, async (req, ctx) => {
  const b = await parseBody(req, z.object({ name: z.string().trim().min(1).max(80), filters: z.record(z.string(), z.unknown()), shared: z.boolean().default(true) }));
  return db.savedFilter.create({ data: { workspaceId: ctx.workspace.id, userId: ctx.user.id, name: b.name, filters: b.filters as object, shared: b.shared } });
});
