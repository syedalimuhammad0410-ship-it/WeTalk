"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { Alert } from "../ui/misc";
import { apiFetch } from "@/lib/client";

export function AcceptInvite({ token, workspace, email, currentEmail }: { token: string; workspace: string; email: string; currentEmail: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = email.toLowerCase() !== currentEmail.toLowerCase();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Join {workspace}</h1>
      <p className="mt-1.5 text-sm text-muted">Signed in as {currentEmail}.</p>
      {mismatch && <Alert tone="warning" className="mt-6" title={`This invitation is for ${email}.`}>Sign out and sign in with that address to accept it.</Alert>}
      {error && <Alert tone="danger" className="mt-6" title={error} />}
      <Button
        className="mt-6 w-full"
        size="lg"
        disabled={mismatch}
        loading={loading}
        onClick={async () => {
          setLoading(true);
          try {
            await apiFetch("/api/invitations/accept", { body: { token } });
            router.push("/dashboard");
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
            setLoading(false);
          }
        }}
      >
        Accept invitation
      </Button>
    </div>
  );
}
