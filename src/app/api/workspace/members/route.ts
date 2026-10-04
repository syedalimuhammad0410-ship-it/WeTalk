import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { inviteMember } from "@/lib/server/members";

export const GET = api({}, async (_req, ctx) => {
  const [members, invitations] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.invitation.findMany({ where: { workspaceId: ctx.workspace.id, acceptedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, role: true, expiresAt: true } }),
  ]);
  return { members, invitations };
});

export const POST = api({ permission: "users.manage" }, async (req, ctx) => {
  const body = await parseBody(req, z.object({ email: z.string().trim().email(), role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) }));
  return inviteMember(ctx.workspace.id, { id: ctx.user.id, role: ctx.role }, body.email, body.role);
});
