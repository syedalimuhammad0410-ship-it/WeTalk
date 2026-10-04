import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createSession, getAuthContext, resolveWorkspace, setSessionCookie } from "@/lib/server/auth";
import { encryptSecret } from "@/lib/server/crypto";
import { describeError } from "@/lib/server/errors";
import { env } from "@/lib/server/env";
import { exchangeCode, verifyState } from "@/lib/server/oauth";
import { logActivity } from "@/lib/server/activity";
import { clientIp } from "@/lib/server/api";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  let purpose: "signin" | "gmail" = "signin";
  try {
    purpose = await verifyState(url.searchParams.get("state"));
    if (url.searchParams.get("error")) throw new Error(`Google returned: ${url.searchParams.get("error")}`);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Missing authorization code.");
    const { tokens, profile } = await exchangeCode(code);

    if (purpose === "gmail") {
      const ctx = await getAuthContext();
      if (!ctx) throw new Error("Sign in before connecting Gmail.");
      if (!tokens.refresh_token) throw new Error("Google did not return offline access. Remove WebScout from your Google account permissions and try again.");
      const scopes = tokens.scope ?? "";
      if (!scopes.includes("gmail.send")) throw new Error("Gmail send permission was not granted.");
      const existing = await db.emailAccount.findFirst({ where: { workspaceId: ctx.workspace.id, provider: "GMAIL", emailAddress: profile.email.toLowerCase() } });
      const data = {
        accessTokenEncrypted: encryptSecret(tokens.access_token!),
        refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
        status: "CONNECTED" as const,
        lastError: null,
      };
      if (existing) await db.emailAccount.update({ where: { id: existing.id }, data });
      else {
        await db.emailAccount.updateMany({ where: { workspaceId: ctx.workspace.id }, data: { isDefault: false } });
        await db.emailAccount.create({ data: { workspaceId: ctx.workspace.id, provider: "GMAIL", emailAddress: profile.email.toLowerCase(), displayName: profile.name ?? "", isDefault: true, lastSyncAt: new Date(), ...data } });
      }
      await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "email.connected", summary: `Gmail account ${profile.email} connected` });
      return NextResponse.redirect(new URL("/settings/email?connected=gmail", env.appUrl()));
    }

    const email = profile.email.toLowerCase();
    let user = (await db.user.findUnique({ where: { googleId: profile.sub } })) ?? (await db.user.findUnique({ where: { email } }));
    if (!user) {
      user = await db.user.create({ data: { email, name: profile.name ?? email.split("@")[0]!, googleId: profile.sub, avatarUrl: profile.picture ?? null, isSystemAdmin: env.systemAdminEmails().includes(email) || (await db.user.count()) === 0 } });
    } else if (!user.googleId) {
      user = await db.user.update({ where: { id: user.id }, data: { googleId: profile.sub, avatarUrl: user.avatarUrl ?? profile.picture ?? null } });
    }
    const s = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    await setSessionCookie(s.token, s.expiresAt);
    const m = await resolveWorkspace(user);
    return NextResponse.redirect(new URL(m ? "/dashboard" : "/onboarding", env.appUrl()));
  } catch (e) {
    const back = purpose === "gmail" ? "/settings/email" : "/login";
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(describeError(e))}`, env.appUrl()));
  }
}
