import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Cloud, Smartphone, Trophy, Brain, Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';
import { APP_TAGLINE } from '../../shared/curriculum.ts';
import { useApp } from '../lib/store.tsx';
import { errMsg } from '../lib/api.ts';
import { Logo } from '../components/Logo.tsx';
import { Button } from '../components/ui.tsx';

const FEATURES = [
  { e: '🧭', t: 'Adaptive placement', d: 'Find your real level — not just your grade.' },
  { e: '💬', t: 'AI math tutor', d: 'Hints and questions that teach you to think.' },
  { e: '📸', t: 'Homework helper', d: 'Snap a photo, then work it out step by step.' },
  { e: '✨', t: 'Learn anything', d: 'Calculus, finance, rockets — we’ll build the path.' },
  { e: '🎯', t: 'Test prep', d: 'Personal study plans, readiness and mock tests.' },
  { e: '🎤', t: 'Presentation practice', d: 'Explain math out loud and get feedback.' },
];

export default function Welcome() {
  const { user, continueAsGuest } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get('error') === 'oauth_cancelled' ? 'Sign-in was cancelled.' : '');

  async function guest() {
    setBusy(true); setError('');
    try { if (!user) await continueAsGuest(); nav('/profiles'); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(closest-side, var(--accent), transparent), radial-gradient(closest-side, var(--accent-2), transparent)' }} />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        {user ? <Button variant="secondary" onClick={() => nav('/profiles')}>Open Mathly</Button> : <Link to="/auth?mode=login" className="text-sm font-semibold text-accent">Sign in</Link>}
      </header>
      <main className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent"><Sparkles className="h-4 w-4" />Kindergarten → University</span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] sm:text-6xl">An AI math tutor <span className="gradient-text">that grows with you.</span></h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{APP_TAGLINE} Understand the problem, plan, solve, check — and explain why it works.</p>
          {error && <p className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={() => nav('/auth?mode=register')} icon={<Cloud className="h-5 w-5" />}>Create an account</Button>
            <Button size="lg" variant="secondary" loading={busy} onClick={guest}>Continue without an account <ArrowRight className="h-5 w-5" /></Button>
          </div>
          <p className="mt-3 text-sm text-muted">No account needed to start. Create one any time to save your progress across devices.</p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {[{ i: Cloud, t: 'Cloud progress & backup' }, { i: Smartphone, t: 'Use on every device' }, { i: Trophy, t: 'Keep XP & achievements' }].map(({ i: I, t }) => (
              <div key={t} className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-soft text-accent"><I className="h-4 w-4" /></span>{t}</div>
            ))}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="card relative p-6">
          <div className="mb-4 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent"><Brain className="h-6 w-6" /></div><div><p className="font-bold">Solve: 3x + 5 = 20</p><p className="text-sm text-muted">Learning Mode</p></div></div>
          <div className="space-y-2.5 text-[0.95rem]">
            {[['UNDERSTAND', 'We need the value of x that makes both sides equal.'], ['PLAN', 'Undo the + 5 first, then undo × 3.'], ['SOLVE', '3x = 15 → x = 5'], ['CHECK', '3(5) + 5 = 20 ✓'], ['COMMUNICATE', 'x = 5, because substituting it makes both sides equal.']].map(([k, v], i) => (
              <motion.div key={k} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.12 }} className="flex gap-3 rounded-2xl bg-surface-2 p-3"><span className="w-28 shrink-0 text-xs font-bold tracking-wider text-accent">{k}</span><span>{v}</span></motion.div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl bg-warn-soft p-3 text-sm"><strong>Tutor:</strong> “You’re close. What operation would undo multiplication by 3?”</div>
        </motion.div>
      </main>
      <section className="relative mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => <motion.div key={f.t} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="card p-5"><div className="text-3xl">{f.e}</div><h3 className="mt-3 font-bold">{f.t}</h3><p className="mt-1 text-sm text-muted">{f.d}</p></motion.div>)}
        </div>
        <p className="mt-10 flex items-center justify-center gap-2 text-center text-sm text-muted"><ShieldCheck className="h-4 w-4" />Privacy first: minimal data, no selling of educational data, export or delete anytime.</p>
      </section>
    </div>
  );
}
