// Edge/Node-safe session helpers (used by proxy.ts and route handlers).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "trace_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionClaims {
  email: string;
  name: string;
}

function secretKey() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) return null;
  return new TextEncoder().encode(s);
}

export async function createSessionToken(claims: SessionClaims) {
  const key = secretKey();
  if (!key) throw new Error("AUTH_SECRET is not configured (min 32 chars).");
  return new SignJWT({ name: claims.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.email)
    .setIssuedAt()
    .setIssuer("trace")
    .setAudience("trace-app")
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { issuer: "trace", audience: "trace-app", algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const allowed = allowedEmails();
    if (!allowed.includes(payload.sub.toLowerCase())) return null; // revocation by removing from allow-list
    return { email: payload.sub, name: String(payload.name || "") };
  } catch {
    return null;
  }
}

export function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
