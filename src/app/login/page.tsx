"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Lock, Mail } from "lucide-react";
import { WorldMap } from "@/components/WorldMap";
import { Logo } from "@/components/Logo";
import { Button, inputCls } from "@/components/ui";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Sign-in failed.");
      setWelcome(j.name || "Investigator");
      const next = params.get("next");
      const dest = next && next.startsWith("/app") ? next : "/app";
      setTimeout(() => window.location.assign(dest), 3200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink px-4">
      <WorldMap className="absolute inset-0 h-full w-full opacity-70" arcs={5} />
      <div className="vignette absolute inset-0" />
      <div className="grain pointer-events-none absolute inset-0 overflow-hidden" />

      <AnimatePresence mode="wait">
        {!welcome ? (
          <motion.div key="form" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }} transition={{ duration: 0.5 }} className="relative z-10 w-full max-w-[380px]">
            <div className="mb-8 flex justify-center">
              <Logo />
            </div>
            <form onSubmit={submit} className="rounded-card border border-line-strong bg-panel/85 p-6 shadow-2xl backdrop-blur-md">
              <div className="label-mono mb-1 text-cyan">Restricted access</div>
              <h1 className="mb-5 text-[19px] font-semibold tracking-tight">Sign in to TRACE</h1>
              <label className="mb-3 block">
                <span className="label-mono mb-1.5 block text-mute">Email</span>
                <span className="relative block">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-mute" />
                  <input className={`${inputCls} pl-9`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </span>
              </label>
              <label className="mb-5 block">
                <span className="label-mono mb-1.5 block text-mute">Password</span>
                <span className="relative block">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-mute" />
                  <input className={`${inputCls} pl-9`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </span>
              </label>
              {error && (
                <div role="alert" className="mb-4 rounded-[4px] border border-alert/30 bg-alert/10 px-3 py-2 text-[12.5px] text-alert">
                  {error}
                </div>
              )}
              <Button type="submit" variant="primary" className="w-full" loading={loading}>
                Sign in
              </Button>
              <p className="mt-4 text-center text-[11.5px] text-mute">Only authorized accounts can access this workspace.</p>
            </form>
          </motion.div>
        ) : (
          <motion.div key="welcome" className="relative z-10 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }} className="mx-auto mb-8 h-px w-64 origin-left bg-gradient-to-r from-transparent via-cyan to-transparent" />
            <motion.div initial={{ opacity: 0, letterSpacing: "0.6em" }} animate={{ opacity: 1, letterSpacing: "0.32em" }} transition={{ duration: 1.2, delay: 0.2 }} className="label-mono mb-5 text-cyan">
              Identity verified · access granted
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 1.1, delay: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
              className="text-[clamp(36px,7vw,76px)] font-semibold tracking-[-0.035em]"
            >
              Welcome {welcome}
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }} className="mt-5 text-[14px] text-dim">
              Opening your investigation workspace…
            </motion.p>
            <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 2.6, delay: 0.4, ease: "linear" }} className="mx-auto mt-8 h-[2px] w-48 origin-left bg-cyan/70" />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
