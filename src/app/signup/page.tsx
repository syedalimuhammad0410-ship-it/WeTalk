"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Lock, Mail, User } from "lucide-react";
import { WorldMap } from "@/components/WorldMap";
import { Logo } from "@/components/Logo";
import { Button, inputCls } from "@/components/ui";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<"pending" | "active" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Sign-up failed.");
      setDone(j.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink px-4">
      <WorldMap className="absolute inset-0 h-full w-full opacity-70" arcs={5} />
      <div className="vignette absolute inset-0" />
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        {done ? (
          <div className="rounded-card border border-line-strong bg-panel/85 p-6 text-center shadow-2xl backdrop-blur-md">
            <CheckCircle2 className="mx-auto mb-3 size-8 text-ok" />
            <h1 className="text-[19px] font-semibold">Account created</h1>
            <p className="mt-2 text-[13.5px] text-dim">{done === "pending" ? "Your account is waiting for approval by the workspace owner. You can sign in once it has been approved." : "You can sign in now."}</p>
            <a href="/login" className="mt-5 inline-flex h-9 items-center rounded-[5px] bg-fg px-4 text-[13px] font-medium text-ink">
              Go to sign in
            </a>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-card border border-line-strong bg-panel/85 p-6 shadow-2xl backdrop-blur-md">
            <div className="label-mono mb-1 text-cyan">New account</div>
            <h1 className="mb-5 text-[19px] font-semibold tracking-tight">Create a TRACE account</h1>
            {[
              { l: "Name", v: name, s: setName, t: "text", i: User, ac: "name" },
              { l: "Email", v: email, s: setEmail, t: "email", i: Mail, ac: "email" },
              { l: "Password (min 8 characters)", v: password, s: setPassword, t: "password", i: Lock, ac: "new-password" },
              { l: "Confirm password", v: confirm, s: setConfirm, t: "password", i: Lock, ac: "new-password" },
            ].map((f) => (
              <label key={f.l} className="mb-3 block">
                <span className="label-mono mb-1.5 block text-mute">{f.l}</span>
                <span className="relative block">
                  <f.i className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-mute" />
                  <input className={`${inputCls} pl-9`} type={f.t} autoComplete={f.ac} required value={f.v} onChange={(e) => f.s(e.target.value)} />
                </span>
              </label>
            ))}
            {error && (
              <div role="alert" className="mb-4 rounded-[4px] border border-alert/30 bg-alert/10 px-3 py-2 text-[12.5px] text-alert">
                {error}
              </div>
            )}
            <Button type="submit" variant="primary" className="mt-2 w-full" loading={loading}>
              Create account
            </Button>
            <p className="mt-4 text-center text-[12px] text-mute">
              Already have an account?{" "}
              <a href="/login" className="text-cyan hover:underline">
                Sign in
              </a>
            </p>
          </form>
        )}
      </motion.div>
    </main>
  );
}
