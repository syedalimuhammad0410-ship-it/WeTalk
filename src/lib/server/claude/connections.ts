import "../guard";
import { createHash, randomBytes } from "node:crypto";
import type { ClaudeConnection } from "@prisma/client";
import { db } from "../../db";
import { AppError } from "../errors";
import { logActivity } from "../activity";
import { env } from "../env";

/**
 * A Claude connection is a secret link Claude uses to reach one workspace: added to Claude as a
 * custom connector (remote MCP), or pasted into the WebScout desktop extension. Only a SHA-256
 * hash of the token is stored; the link is shown once.
 */
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
/** Public address of this app (APP_URL, or Render's automatic RENDER_EXTERNAL_URL). */
export const appUrl = () => env.appUrl();
export const connectorUrl = (token: string) => `${appUrl()}/api/mcp/${token}`;

const recent = (d: Date | null, ms: number) => Boolean(d && Date.now() - d.getTime() < ms);

/** active = Claude used it in the last 3 minutes; ready = desktop extension running; idle/never otherwise. */
export function connectionState(c: Pick<ClaudeConnection, "lastSeenAt" | "companionSeenAt" | "revokedAt">) {
  if (c.revokedAt) return "revoked" as const;
  if (recent(c.lastSeenAt, 3 * 60_000)) return "active" as const;
  if (recent(c.companionSeenAt, 3 * 60_000)) return "ready" as const;
  return c.lastSeenAt || c.companionSeenAt ? ("idle" as const) : ("never" as const);
}

export function publicConnection(c: ClaudeConnection) {
  return {
    id: c.id, name: c.name, tokenHint: c.tokenHint, lastSeenAt: c.lastSeenAt, lastClient: c.lastClient, companionSeenAt: c.companionSeenAt,
    deviceName: c.deviceName, platform: c.platform, createdAt: c.createdAt, revokedAt: c.revokedAt, state: connectionState(c),
  };
}

export async function createConnection(workspaceId: string, userId: string, name: string) {
  const active = await db.claudeConnection.count({ where: { workspaceId, revokedAt: null } });
  if (active >= 10) throw new AppError("VALIDATION", "You already have 10 Claude connections. Remove one you no longer use first.");
  const token = `wsc_${randomBytes(32).toString("base64url")}`;
  const c = await db.claudeConnection.create({ data: { workspaceId, createdById: userId, name: name.trim().slice(0, 60) || "Claude", tokenHash: hashToken(token), tokenHint: token.slice(-4) } });
  await logActivity({ workspaceId, userId, action: "claude.connection_created", summary: `Claude connection “${c.name}” created` });
  return { connection: publicConnection(c), token, url: connectorUrl(token) };
}

export async function revokeConnection(workspaceId: string, userId: string, id: string) {
  const c = await db.claudeConnection.findFirst({ where: { id, workspaceId } });
  if (!c) throw new AppError("NOT_FOUND", "Connection not found.");
  if (!c.revokedAt) await db.claudeConnection.update({ where: { id }, data: { revokedAt: new Date() } });
  await logActivity({ workspaceId, userId, action: "claude.connection_revoked", summary: `Claude connection “${c.name}” removed — its link no longer works` });
  return { ok: true };
}

/** The live connection for a secret token, or null when unknown or revoked. */
export async function authenticateToken(token: string | null | undefined) {
  const t = token?.trim();
  if (!t || !/^wsc_[A-Za-z0-9_-]{30,80}$/.test(t)) return null;
  const c = await db.claudeConnection.findUnique({ where: { tokenHash: hashToken(t) } });
  return c && !c.revokedAt ? c : null;
}

export function bearerToken(req: Request) {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? null;
}

/** Records that Claude used the connection (throttled to one write per 15 s). */
export async function touchConnection(c: ClaudeConnection, client?: string | null) {
  const fresh = c.lastSeenAt && Date.now() - c.lastSeenAt.getTime() < 15_000;
  if (fresh && (!client || client === c.lastClient)) return;
  await db.claudeConnection.update({ where: { id: c.id }, data: { lastSeenAt: new Date(), ...(client ? { lastClient: client.slice(0, 120) } : {}) } });
}

/** The desktop extension (local companion) reports that Claude Desktop is open on this computer. */
export async function companionHeartbeat(c: ClaudeConnection, info: { device?: string; platform?: string }) {
  const first = !c.companionSeenAt;
  await db.claudeConnection.update({
    where: { id: c.id },
    data: { companionSeenAt: new Date(), deviceName: info.device?.slice(0, 80) || c.deviceName, platform: info.platform?.slice(0, 40) || c.platform },
  });
  if (first) {
    await db.claudeTaskEvent.create({ data: { workspaceId: c.workspaceId, type: "COMPANION_CONNECTED", message: `Desktop extension connected${info.device ? ` on ${info.device.slice(0, 60)}` : ""}` } });
  }
}
