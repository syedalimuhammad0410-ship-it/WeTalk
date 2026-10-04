"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form";
import { Alert } from "../ui/misc";
import { apiFetch } from "@/lib/client";

export function AuthForm({ mode, googleEnabled, invite, inviteEmail }: { mode: "login" | "signup"; googleEnabled: boolean; invite?: string; inviteEmail?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(inviteEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error"));
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await apiFetch<{ next: string }>(`/api/auth/${mode}`, { body: mode === "signup" ? { name, email, password, invite } : { email, password } });
      const next = params.get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : r.next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Welcome back" : invite ? "Join your team" : "Create your account"}</h1>
      <p className="mt-1.5 text-sm text-muted">{mode === "login" ? "Sign in to your WebScout AI workspace." : "Start finding and winning website clients."}</p>
      {error && <Alert tone="danger" className="mt-6" title={error} />}
      {googleEnabled && (
        <>
          <a href="/api/auth/google" className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface text-sm font-medium shadow-sm transition-colors hover:bg-subtle">
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continue with Google
          </a>
          <div className="my-6 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form onSubmit={submit} className={googleEnabled ? "space-y-4" : "mt-6 space-y-4"} noValidate>
        {mode === "signup" && (
          <Field label="Full name" htmlFor="name" required>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        )}
        <Field label="Work email" htmlFor="email" required>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={Boolean(inviteEmail)} />
        </Field>
        <Field label="Password" htmlFor="password" required hint={mode === "signup" ? "At least 10 characters, with letters and numbers." : undefined}>
          <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={loading} loadingText={mode === "login" ? "Signing in…" : "Creating account…"}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            New to WebScout AI? <Link href="/signup" className="font-medium text-accent hover:underline">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href={invite ? `/login?next=/invite/${invite}` : "/login"} className="font-medium text-accent hover:underline">Sign in</Link>
          </>
        )}
      </p>
    </div>
  );
}
