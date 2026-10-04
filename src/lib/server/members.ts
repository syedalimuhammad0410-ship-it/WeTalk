import "./guard";
import type { Role } from "@prisma/client";
import { db } from "../db";
import { AppError } from "./errors";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";
import { logActivity } from "./activity";

export async function inviteMember(workspaceId: string, inviter: { id: string; role: Role }, email: string, role: Role) {
  if (role === "OWNER" && inviter.role !== "OWNER") throw new AppError("FORBIDDEN", "Only owners can invite another owner.");
  const lower = email.trim().toLowerCase();
  const existingUser = await db.user.findUnique({ where: { email: lower }, include: { memberships: { where: { workspaceId } } } });
  if (existingUser?.memberships.length) throw new AppError("CONFLICT", `${lower} is already a member of this workspace.`);
  const token = randomToken(24);
  await db.invitation.deleteMany({ where: { workspaceId, email: lower, acceptedAt: null } });
  await db.invitation.create({ data: { workspaceId, email: lower, role, tokenHash: sha256(token), invitedById: inviter.id, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
  await logActivity({ workspaceId, userId: inviter.id, action: "member.invited", summary: `Invited ${lower} as ${role.toLowerCase()}` });
  return { link: `${env.appUrl()}/invite/${token}`, expiresInDays: 7 };
}

export async function acceptInvitation(token: string, userId: string, userEmail: string) {
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new AppError("NOT_FOUND", "This invitation is invalid or has expired. Ask for a new link.");
  if (inv.email !== userEmail.toLowerCase()) throw new AppError("FORBIDDEN", `This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
  await db.$transaction([
    db.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } }, create: { workspaceId: inv.workspaceId, userId, role: inv.role }, update: {} }),
    db.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
    db.user.update({ where: { id: userId }, data: { lastWorkspaceId: inv.workspaceId } }),
  ]);
  await logActivity({ workspaceId: inv.workspaceId, userId, action: "member.joined", summary: `${userEmail} joined as ${inv.role.toLowerCase()}` });
  return inv.workspaceId;
}

export async function changeMemberRole(workspaceId: string, actor: { id: string; role: Role }, memberId: string, role: Role) {
  const m = await db.workspaceMember.findFirst({ where: { id: memberId, workspaceId }, include: { user: true } });
  if (!m) throw new AppError("NOT_FOUND", "Member not found.");
  if ((m.role === "OWNER" || role === "OWNER") && actor.role !== "OWNER") throw new AppError("FORBIDDEN", "Only owners can change owner roles.");
  if (m.role === "OWNER" && role !== "OWNER") {
    const owners = await db.workspaceMember.count({ where: { workspaceId, role: "OWNER" } });
    if (owners <= 1) throw new AppError("CONFLICT", "A workspace must keep at least one owner.");
  }
  await db.workspaceMember.update({ where: { id: memberId }, data: { role } });
  await logActivity({ workspaceId, userId: actor.id, action: "member.role_changed", summary: `${m.user.email} is now ${role.toLowerCase()}` });
}

export async function removeMember(workspaceId: string, actor: { id: string; role: Role }, memberId: string) {
  const m = await db.workspaceMember.findFirst({ where: { id: memberId, workspaceId }, include: { user: true } });
  if (!m) throw new AppError("NOT_FOUND", "Member not found.");
  if (m.role === "OWNER") {
    if (actor.role !== "OWNER") throw new AppError("FORBIDDEN", "Only owners can remove an owner.");
    const owners = await db.workspaceMember.count({ where: { workspaceId, role: "OWNER" } });
    if (owners <= 1) throw new AppError("CONFLICT", "A workspace must keep at least one owner.");
  }
  await db.workspaceMember.delete({ where: { id: memberId } });
  await logActivity({ workspaceId, userId: actor.id, action: "member.removed", summary: `Removed ${m.user.email}` });
}
