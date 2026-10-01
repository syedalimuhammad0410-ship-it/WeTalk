import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { PublicQuestion } from '../../shared/types.ts';
import { post, get, errMsg } from '../lib/api.ts';
import { celebrate } from '../lib/celebrate.ts';
import { useApp } from '../lib/store.tsx';
import { Logo } from '../components/Logo.tsx';
import { MathVisual } from '../components/MathVisual.tsx';
import { Badge, Button, Card, ErrorState, Progress, RichText, Spinner, cx } from '../components/ui.tsx';

interface Step { question: PublicQuestion; domain: string; domainName: string; progress: { asked: number; total: number } }
export interface PlacementResult {
  schoolLabel: string; overall: number | null; overallLabel: string;
  domains: { domain: string; name: string; icon: string; level: number; label: string }[];
  topics: { domain: string; name: string; icon: string; percent: number }[];
  strengths: { name: string; icon: string; label: string }[]; weaknesses: { name: string; icon: string; label: string }[];
  missingPrerequisites: { id: string; title: string; grade: string }[];
  path: { skillId: string; title: string; reason: string; minutes: number }[];
}

export default function Placement() {
  const { refreshProfiles, profile } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState<Step | null>(null);
  const [intro, setIntro] = useState<{ domains: string[]; total: number } | null>(null);
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);

  async function start() {
    setError(null); setBusy(true);
    try { const r = await post<Step & { intro: { domains: string[]; total: number } }>('/me/placement/start'); setIntro(r.intro); setStep(r); setStarted(true); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  useEffect(() => { if (profile?.placementDone) get<{ result: PlacementResult }>('/me/placement/result').then((r) => setResult(r.result)).catch(() => {}); }, [profile?.placementDone]);

  async function answer(skip = false, v = value) {
    if (!step || busy || (!skip && !v.trim())) return;
    setBusy(true);
    try {
      const r = await post<Partial<Step> & { correct: boolean; feedback: string; done?: boolean; result?: PlacementResult; xp?: number; achievements?: never[] }>('/me/placement/answer', { questionId: step.question.id, response: v, skip });
      setFeedback(r.feedback); setValue('');
      if (r.done && r.result) { setResult(r.result); celebrate({ xp: r.xp, achievements: r.achievements }); await refreshProfiles(); }
      else setTimeout(() => { setStep(r as Step); setFeedback(null); }, 450);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (result) return <PlacementResults result={result} onDone={() => nav('/')} onRetake={() => { setResult(null); start(); }} />;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-4 px-5 py-5">
        <Logo size={30} showText={false} />
        <Progress value={step ? (step.progress.asked / step.progress.total) * 100 : 0} label="Placement progress" />
        <Link to="/" className="rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="Exit placement"><X className="h-5 w-5" /></Link>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-10">
        {error && <ErrorState message={error} onRetry={started ? undefined : start} />}
        {!started && !error && (
          <Card className="mt-6 p-8 text-center">
            <div className="text-6xl">🧭</div>
            <h1 className="mt-4 text-3xl font-extrabold">Adaptive placement check</h1>
            <p className="mx-auto mt-3 max-w-md text-muted">Answer what you can. If you don’t know, tap “I don’t know yet” — that’s useful information, not a failure. The questions adapt to you.</p>
            <Button size="lg" className="mt-8" loading={busy} onClick={start}>Let’s begin</Button>
          </Card>
        )}
        {started && step && (
          <motion.div key={step.question.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-4 mt-4 flex items-center justify-between"><Badge tone="accent">{step.domainName}</Badge><span className="text-sm text-muted">Question {step.progress.asked + 1} of {step.progress.total}</span></div>
            <Card className="p-6 sm:p-8">
              <div className="text-xl font-semibold"><RichText text={step.question.prompt} /></div>
              {step.question.visual && <div className="my-5"><MathVisual spec={step.question.visual} /></div>}
              <div className="mt-6">
                {step.question.answerType === 'choice' && step.question.choices ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">{step.question.choices.map((c) => <button key={c} disabled={busy} onClick={() => answer(false, c)} className="min-h-14 rounded-2xl border-2 border-border bg-surface px-4 py-3 text-left font-semibold hover:border-accent">{c}</button>)}</div>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); answer(); }} className="flex gap-2">
                    <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Your answer" placeholder="Your answer" className="h-14 flex-1 rounded-2xl border-2 border-border bg-surface px-4 text-lg font-semibold outline-none focus:border-accent" />
                    <Button type="submit" size="lg" loading={busy} disabled={!value.trim()}>Next</Button>
                  </form>
                )}
              </div>
              {step.question.unit && <p className="mt-2 text-sm text-muted">Units: {step.question.unit}</p>}
              <div className="mt-6 flex items-center justify-between">
                <button onClick={() => answer(true)} disabled={busy} className="text-sm font-semibold text-muted hover:text-text">I don’t know yet →</button>
                {feedback && <span className={cx('text-sm font-semibold', feedback === 'Nice!' ? 'text-success' : 'text-muted')} role="status">{feedback}</span>}
              </div>
            </Card>
            {intro && <p className="mt-4 text-center text-xs text-muted">Areas: {intro.domains.join(' · ')}</p>}
          </motion.div>
        )}
        {started && !step && !error && <Spinner />}
      </main>
    </div>
  );
}

export function PlacementResults({ result, onDone, onRetake }: { result: PlacementResult; onDone: () => void; onRetake?: () => void }) {
  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-accent">Your math profile</p>
        <h1 className="mt-2 text-4xl font-extrabold">You’re working at about <span className="gradient-text">{result.overallLabel}</span></h1>
        <p className="mt-2 text-muted">School level: {result.schoolLabel}. Your learning level updates continuously as you learn.</p>
      </motion.div>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-bold">Topic mastery</h2>
          <div className="mt-4 space-y-3">{result.topics.map((t) => <div key={t.domain}><div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{t.icon} {t.name}</span><span className="font-bold">{t.percent}%</span></div><Progress value={t.percent} tone={t.percent >= 75 ? 'success' : t.percent >= 50 ? 'accent' : 'warn'} label={t.name} /></div>)}</div>
        </Card>
        <div className="space-y-5">
          <Card className="p-6"><h2 className="font-bold">Learning level by area</h2><div className="mt-3 grid grid-cols-2 gap-2">{result.domains.map((d) => <div key={d.domain} className="rounded-2xl bg-surface-2 p-3"><div className="text-sm text-muted">{d.icon} {d.name}</div><div className="font-bold">{d.label}</div></div>)}</div></Card>
          <Card className="p-6">
            <h2 className="font-bold">💪 Strengths</h2><p className="mt-1 text-sm text-muted">{result.strengths.map((s) => s.name).join(', ') || 'Keep practicing to reveal your strengths.'}</p>
            <h2 className="mt-4 font-bold">🌱 Still building</h2><p className="mt-1 text-sm text-muted">{result.weaknesses.map((s) => s.name).join(', ') || 'Nothing major — great work!'}</p>
            {result.missingPrerequisites.length > 0 && <><h2 className="mt-4 font-bold">🧩 Foundations to review</h2><ul className="mt-1 space-y-1 text-sm">{result.missingPrerequisites.map((m) => <li key={m.id}><Link to={`/lesson/${m.id}`} className="font-semibold text-accent">{m.title}</Link> <span className="text-muted">· {m.grade}</span></li>)}</ul></>}
          </Card>
        </div>
      </div>
      <Card className="mt-5 p-6">
        <h2 className="font-bold">Your recommended path</h2>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">{result.path.map((p, i) => <li key={p.skillId}><Link to={`/lesson/${p.skillId}`} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 hover:ring-2 hover:ring-accent/40"><span className="bg-brand grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-bold text-white">{i + 1}</span><span className="min-w-0"><span className="block truncate font-semibold">{p.title}</span><span className="block truncate text-xs text-muted">{p.reason}</span></span></Link></li>)}</ol>
      </Card>
      <div className="mt-8 flex flex-wrap justify-center gap-3"><Button size="lg" onClick={onDone}>Go to my dashboard</Button>{onRetake && <Button size="lg" variant="secondary" onClick={onRetake}>Retake placement</Button>}</div>
    </div>
  );
}
