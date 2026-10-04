import "./guard";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { Role, User, Workspace } from "@prisma/client";
import { db } from "../db";
import { randomToken, sha256 } from "./crypto";
import { AppError } from "./errors";
import { env } from "./env";
import { can, type Permission } from "../permissions";

export const SESSION_COOKIE = "ws_session";
const SESSION_DAYS = 30;

export type AuthContext = {
  user: Pick<User, "id" | "email" | "name" | "avatarUrl" | "isSystemAdmin" | "themePreference">;
  workspace: Pick<Workspace, "id" | "name" | "slug" | "isDemo" | "onboardingCompleted" | "onboardingStep">;
  role: Role;
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers.";
  return null;
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt, ipAddress: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function userFromToken(token: string | undefined | null) {
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Touch at most once per hour to avoid a write on every request.
  if (Date.now() - session.lastUsedAt.getTime() > 3600_000) {
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return session.user;
}

export async function getSessionUser() {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

/** Resolves the active workspace for a user (last used, else first membership). */
export async function resolveWorkspace(user: User) {
  const memberships = await db.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;
  return memberships.find((m) => m.workspaceId === user.lastWorkspaceId) ?? memberships[0]!;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const membership = await resolveWorkspace(user);
  if (!membership) return null;
  return {
    user: pickUser(user),
    workspace: pickWorkspace(membership.workspace),
    role: membership.role,
  };
}

export async function requireAuth(): Promise<AuthContext> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  const membership = await resolveWorkspace(user);
  if (!membership) throw new AppError("FORBIDDEN", "Create or join a workspace to continue.");
  return { user: pickUser(user), workspace: pickWorkspace(membership.workspace), role: membership.role };
}

export function assertCan(ctx: Pick<AuthContext, "role">, permission: Permission) {
  if (!can(ctx.role, permission)) {
    throw new AppError("FORBIDDEN", `Your role (${ctx.role.toLowerCase()}) does not allow this action.`);
  }
}

const pickUser = (u: User) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  isSystemAdmin: u.isSystemAdmin,
  themePreference: u.themePreference,
});
const pickWorkspace = (w: Workspace) => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  isDemo: w.isDemo,
  onboardingCompleted: w.onboardingCompleted,
  onboardingStep: w.onboardingStep,
});
