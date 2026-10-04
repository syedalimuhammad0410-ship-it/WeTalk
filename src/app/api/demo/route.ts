import { api } from "@/lib/server/api";
import { createDemoWorkspace } from "@/lib/server/demo";
import { db } from "@/lib/db";

export const POST = api({}, async (_req, ctx) => {
  const existing = await db.workspaceMember.findFirst({ where: { userId: ctx.user.id, workspace: { isDemo: true } } });
  if (existing) {
    await db.user.update({ where: { id: ctx.user.id }, data: { lastWorkspaceId: existing.workspaceId } });
    return { workspaceId: existing.workspaceId, existing: true };
  }
  const ws = await createDemoWorkspace(ctx.user.id);
  return { workspaceId: ws.id };
});
