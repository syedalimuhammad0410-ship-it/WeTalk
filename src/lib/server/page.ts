import "./guard";
import { redirect } from "next/navigation";
import { getAuthContext, getSessionUser, type AuthContext } from "./auth";
import { can, type Permission } from "../permissions";

/** For server components: returns the auth context or redirects to sign-in / onboarding. */
export async function pageContext(opts: { allowIncompleteOnboarding?: boolean } = {}): Promise<AuthContext & { can: (p: Permission) => boolean }> {
  const ctx = await getAuthContext();
  if (!ctx) {
    if (await getSessionUser()) redirect("/onboarding");
    redirect("/login");
  }
  if (!ctx.workspace.onboardingCompleted && !opts.allowIncompleteOnboarding) redirect("/onboarding");
  return { ...ctx, can: (p: Permission) => can(ctx.role, p) };
}
