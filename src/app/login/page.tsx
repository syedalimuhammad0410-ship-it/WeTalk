import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { env } from "@/lib/server/env";
import { getSessionUser } from "@/lib/server/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <AuthShell>
      <Suspense>
        <AuthForm mode="login" googleEnabled={env.googleOAuthConfigured()} />
      </Suspense>
    </AuthShell>
  );
}
