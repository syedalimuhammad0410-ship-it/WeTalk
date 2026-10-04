import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { env } from "@/lib/server/env";
import { getSessionUser } from "@/lib/server/auth";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <AuthShell>
      <Suspense>
        <AuthForm mode="signup" googleEnabled={env.googleOAuthConfigured()} />
      </Suspense>
    </AuthShell>
  );
}
