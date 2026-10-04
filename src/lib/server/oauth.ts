import "./guard";
import { cookies } from "next/headers";
import { env } from "./env";
import { AppError, fetchWithTimeout } from "./errors";
import { randomToken, safeEqual } from "./crypto";
import { GMAIL_SCOPES } from "./email/providers";

const STATE_COOKIE = "ws_oauth_state";

export type OAuthPurpose = "signin" | "gmail";

export async function googleAuthUrl(purpose: OAuthPurpose) {
  if (!env.googleOAuthConfigured()) throw new AppError("NOT_CONFIGURED", "Google OAuth is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const nonce = randomToken(24);
  const state = `${purpose}.${nonce}`;
  (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, secure: env.isProduction(), sameSite: "lax", path: "/", maxAge: 600 });
  const params = new URLSearchParams({
    client_id: env.googleClientId(),
    redirect_uri: `${env.appUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope: purpose === "gmail" ? GMAIL_SCOPES.join(" ") : "openid email profile",
    state,
    ...(purpose === "gmail" ? { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } : { prompt: "select_account" }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function verifyState(state: string | null): Promise<OAuthPurpose> {
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!state || !expected || !safeEqual(state, expected)) throw new AppError("FORBIDDEN", "OAuth state mismatch. Please try again.");
  return state.startsWith("gmail.") ? "gmail" : "signin";
}

export async function exchangeCode(code: string) {
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    service: "Google OAuth",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.googleClientId(), client_secret: env.googleClientSecret(), redirect_uri: `${env.appUrl()}/api/auth/google/callback`, grant_type: "authorization_code" }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error_description?: string; scope?: string };
  if (!res.ok || !data.access_token) throw new AppError("INVALID_CREDENTIALS", `Google sign-in failed: ${data.error_description ?? res.status}`);
  const info = await fetchWithTimeout("https://openidconnect.googleapis.com/v1/userinfo", { service: "Google", headers: { Authorization: `Bearer ${data.access_token}` } });
  const profile = (await info.json()) as { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string };
  if (!profile.email || profile.email_verified === false) throw new AppError("FORBIDDEN", "Your Google account email is not verified.");
  return { tokens: data, profile };
}
