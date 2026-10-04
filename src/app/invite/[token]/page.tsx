import { Suspense } from "react";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/server/crypto";
import { getSessionUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { AcceptInvite } from "@/components/auth/accept-invite";
import { Alert } from "@/components/ui/misc";

export const metadata = { title: "Join workspace" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: { select: { name: true } } } });
  const valid = inv && !inv.acceptedAt && inv.expiresAt > new Date();
  const user = await getSessionUser();
  return (
    <AuthShell>
      {!valid ? (
        <Alert tone="danger" title="This invitation is invalid or has expired." >Ask a workspace admin to send you a new link.</Alert>
      ) : user ? (
        <AcceptInvite token={token} workspace={inv.workspace.name} email={inv.email} currentEmail={user.email} />
      ) : (
        <>
          <p className="mb-6 rounded-lg border border-border bg-subtle px-3 py-2 text-sm">You&apos;ve been invited to <strong>{inv.workspace.name}</strong> as {inv.role.toLowerCase()}.</p>
          <Suspense>
            <AuthForm mode="signup" googleEnabled={env.googleOAuthConfigured()} invite={token} inviteEmail={inv.email} />
          </Suspense>
        </>
      )}
    </AuthShell>
  );
}
