import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Timer, Search, Shuffle } from 'lucide-react';
import type { PublicQuestion } from '../../shared/types.ts';
import { SKILLS } from '../../shared/skills.ts';
import { DOMAINS } from '../../shared/curriculum.ts';
import { useApp } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { celebrate, toast } from '../lib/celebrate.ts';
import { MathVisual } from '../components/MathVisual.tsx';
import { StepLine } from '../components/QuestionCard.tsx';
import { Badge, Button, Card, Chip, PageHeader, Progress, Ring, RichText, Textarea, Toggle, cx } from '../components/ui.tsx';

type MQ = PublicQuestion & { format: 'mc' | 'short' | 'written'; skillTitle?: string; explainPrompt?: string };
interface Analysis { score: number; points: number; max: number; topics: { skillId: string; title: string; percent: number }[]; mastered: { title: string }[]; needsReview: { skillId: string; title: string; percent: number }[]; mistakes: { type: string; count: number; message: string }[]; recommendedLessons: { title: string; link: string }[]; recommendedPractice: { title: string; link: string }[]; timeTakenSec: number }
interface Review { id: string; prompt: string; format: string; skillTitle?: string; response: string; correct: boolean; earned: number; worth: number; feedback: string; answer: string; unit?: string; steps: string[]; explanation: string; writtenNote: string | null }

export default function MockTest() {
  const [params] = useSearchParams();
  const planId = params.get('plan');
  const { profile } = useApp();
  const [config, setConfig] = useState({ count: 10, timed: true, minutes: 20, calculator: true, formats: ['mc', 'short'] as string[] });
  const [skills, setSkills] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [test, setTest] = useState<{ id: string; questions: MQ[]; config: { minutes: number | null; timed: boolean; seed: number } } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const [result, setResult] = useState<{ analysis: Analysis; review: Review[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const level = profile?.learningLevel ?? profile?.schoolGrade ?? 7;
  const options = useMemo(() => SKILLS.filter((s) => (q ? `${s.title} ${s.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()) : Math.abs(s.grade - level) <= 1.5)).slice(0, 30), [q, level]);

  async function start(seed?: number) {
    setBusy(true); setResult(null); setAnswers({}); setExplanations({}); setIdx(0);
    try {
      const r = await post<{ id: string; questions: MQ[]; config: { minutes: number | null; timed: boolean; seed: number } }>('/me/mock-tests', { testPlanId: planId, skills, ...config, seed });
      setTest(r); setLeft(r.config.timed && r.config.minutes ? r.config.minutes * 60 : null);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function submit() {
    if (!test || busy) return;
    setBusy(true);
    try { const r = await post<{ analysis: Analysis; review: Review[]; xp: number; achievements: never[] }>(`/me/mock-tests/${test.id}/submit`, { answers, explanations }); setResult(r); celebrate(r); setLeft(null); window.scrollTo({ top: 0 }); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (left === null || result) return;
    if (left <= 0) { toast('Time’s up — submitting your test.', 'info'); submit(); return; }
    const t = setTimeout(() => setLeft((l) => (l === null ? null : l - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, result]);

  if (result) {
    const a = result.analysis;
    return (
      <div className="space-y-6">
        <Card className="flex flex-wrap items-center gap-6 p-6">
          <Ring value={a.score} size={120} stroke={10} color={a.score >= 80 ? 'var(--success)' : a.score >= 60 ? 'var(--accent)' : 'var(--warn)'}><div className="text-3xl font-extrabold">{a.score}%</div></Ring>
          <div className="flex-1"><h1 className="text-2xl font-extrabold">Mock test results</h1><p className="text-muted">{a.points}/{a.max} points · {Math.floor(a.timeTakenSec / 60)}m {a.timeTakenSec % 60}s</p><p className="mt-2">{a.score >= 80 ? 'Excellent work — you’re well prepared on these topics.' : a.score >= 60 ? 'Good progress. Focus on the topics below to boost your score.' : 'You’re still building these skills — the recommendations below will help most.'}</p></div>
          <div className="flex flex-wrap gap-2"><Button icon={<Shuffle className="h-4 w-4" />} onClick={() => start()}>New randomized version</Button>{planId && <Link to={`/test-prep/${planId}`}><Button variant="secondary">Back to plan</Button></Link>}</div>
        </Card>
        <div className="grid gap-5 md:grid-cols-3">
          <Card className="p-5"><h2 className="font-bold">Topics mastered</h2><ul className="mt-2 space-y-1 text-sm">{a.mastered.length ? a.mastered.map((m) => <li key={m.title}>✅ {m.title}</li>) : <li className="text-muted">Keep going — you’ll get there.</li>}</ul></Card>
          <Card className="p-5"><h2 className="font-bold">Needs review</h2><ul className="mt-2 space-y-1 text-sm">{a.needsReview.length ? a.needsReview.map((m) => <li key={m.skillId}>🌱 {m.title} <span className="text-muted">({m.percent}%)</span></li>) : <li className="text-muted">Nothing — great job!</li>}</ul></Card>
          <Card className="p-5"><h2 className="font-bold">Mistake analysis</h2><ul className="mt-2 space-y-2 text-sm">{a.mistakes.length ? a.mistakes.map((m) => <li key={m.type}><Badge tone="warn">×{m.count}</Badge> {m.message}</li>) : <li className="text-muted">No repeated mistake patterns found.</li>}</ul></Card>
        </div>
        {(a.recommendedLessons.length > 0) && <Card className="p-5"><h2 className="font-bold">Recommended next</h2><div className="mt-3 flex flex-wrap gap-2">{a.recommendedLessons.map((l) => <Link key={l.link} to={l.link}><Badge tone="accent">📚 {l.title}</Badge></Link>)}{a.recommendedPractice.map((l) => <Link key={l.link} to={l.link}><Badge tone="success">🎯 Practice {l.title}</Badge></Link>)}</div></Card>}
        <h2 className="text-lg font-bold">Review your answers</h2>
        <div className="space-y-3">{result.review.map((r, i) => (
          <Card key={r.id} className={cx('p-5 border-l-4', r.correct ? 'border-l-success' : 'border-l-warn')}>
            <div className="flex flex-wrap items-center gap-2"><span className="font-bold">Q{i + 1}</span><Badge>{r.skillTitle}</Badge><Badge tone={r.correct ? 'success' : 'warn'}>{r.earned}/{r.worth}</Badge></div>
            <div className="mt-2 font-semibold"><RichText text={r.prompt} /></div>
            <p className="mt-2 text-sm">Your answer: <strong>{r.response || '—'}</strong> · Correct: <strong>{r.answer}{r.unit ? ` ${r.unit}` : ''}</strong></p>
            {r.writtenNote && <p className="mt-1 text-sm text-muted">{r.writtenNote}</p>}
            {!r.correct && <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold text-accent">Show worked solution</summary><ol className="mt-2 space-y-1">{r.steps.map((s, k) => <li key={k}><StepLine s={s} /></li>)}</ol></details>}
          </Card>
        ))}</div>
      </div>
    );
  }

  if (test) {
    const cur = test.questions[idx];
    const answered = test.questions.filter((x) => answers[x.id]?.trim()).length;
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-xl font-extrabold">Mock test</h1>
          {left !== null && <Badge tone={left < 60 ? 'danger' : 'accent'} className="text-base"><Timer className="h-4 w-4" />{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Badge>}
          <Badge>{answered}/{test.questions.length} answered</Badge>
        </div>
        <div className="scrollbar-thin mb-4 flex gap-1.5 overflow-x-auto pb-1">{test.questions.map((x, i) => <button key={x.id} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}`} className={cx('h-9 w-9 shrink-0 rounded-xl text-sm font-bold', i === idx ? 'bg-brand text-white' : answers[x.id]?.trim() ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>{i + 1}</button>)}</div>
        <Card className="p-6">
          <div className="mb-3 flex gap-2"><Badge tone="accent">{cur.skillTitle}</Badge><Badge>{cur.format === 'mc' ? 'Multiple choice' : cur.format === 'written' ? 'Written response' : 'Short answer'}</Badge></div>
          <div className="text-lg font-semibold"><RichText text={cur.prompt} /></div>
          {cur.visual && <div className="my-4"><MathVisual spec={cur.visual} /></div>}
          <div className="mt-5">
            {cur.answerType === 'choice' && cur.choices ? <div className="grid gap-2 sm:grid-cols-2">{cur.choices.map((c) => <button key={c} onClick={() => setAnswers((a) => ({ ...a, [cur.id]: c }))} className={cx('min-h-12 rounded-2xl border-2 px-4 py-2 text-left font-semibold', answers[cur.id] === c ? 'border-accent bg-accent-soft' : 'border-border hover:border-accent/50')}>{c}</button>)}</div>
              : <div className="relative"><input value={answers[cur.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [cur.id]: e.target.value }))} placeholder="Your answer" aria-label="Your answer" className="h-14 w-full rounded-2xl border-2 border-border bg-surface px-4 text-lg font-semibold outline-none focus:border-accent" />{cur.unit && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted">{cur.unit}</span>}</div>}
            {cur.format === 'written' && <div className="mt-4"><Textarea label="Show your reasoning" value={explanations[cur.id] ?? ''} onChange={(e) => setExplanations((x) => ({ ...x, [cur.id]: e.target.value }))} placeholder="Explain each step and why it works…" /></div>}
          </div>
          <div className="mt-6 flex justify-between"><Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Previous</Button>{idx < test.questions.length - 1 ? <Button onClick={() => setIdx(idx + 1)}>Next</Button> : <Button loading={busy} onClick={() => { if (answered < test.questions.length && !confirm(`You have ${test.questions.length - answered} unanswered question(s). Submit anyway?`)) return; submit(); }}>Submit test</Button>}</div>
        </Card>
        <div className="mt-4"><Progress value={(answered / test.questions.length) * 100} label="Answered" /></div>
        <p className="mt-3 text-center text-xs text-muted">{test.config.timed ? 'Timed test — it submits automatically when time runs out.' : 'Untimed — take your time.'} No hints during mock tests.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Mock test" subtitle="A realistic practice test. Randomized every time, checked by our math engine, with full analysis afterwards." />
      <Card className="space-y-5 p-6">
        {!planId && (
          <div>
            <p className="mb-2 text-sm font-semibold">Topics</p>
            <div className="mb-2 flex items-center gap-2 rounded-2xl border border-border px-3"><Search className="h-4 w-4 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…" aria-label="Search topics" className="h-11 flex-1 bg-transparent outline-none" /></div>
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">{options.map((s) => <Chip key={s.id} selected={skills.includes(s.id)} onClick={() => setSkills((c) => (c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id]))}>{DOMAINS[s.domain].icon} {s.title}</Chip>)}</div>
          </div>
        )}
        {planId && <p className="rounded-2xl bg-accent-soft p-3 text-sm font-semibold text-accent">Covers every topic in your test plan.</p>}
        <div><p className="mb-2 text-sm font-semibold">Number of questions</p><div className="flex flex-wrap gap-2">{[5, 10, 15, 20].map((n) => <Chip key={n} selected={config.count === n} onClick={() => setConfig((c) => ({ ...c, count: n }))}>{n}</Chip>)}</div></div>
        <Toggle checked={config.timed} onChange={(v) => setConfig((c) => ({ ...c, timed: v }))} label="Timed" description={config.timed ? `${config.minutes} minutes` : 'Untimed'} />
        {config.timed && <div className="flex flex-wrap gap-2">{[10, 20, 30, 45, 60].map((m) => <Chip key={m} selected={config.minutes === m} onClick={() => setConfig((c) => ({ ...c, minutes: m }))}>{m} min</Chip>)}</div>}
        <Toggle checked={config.calculator} onChange={(v) => setConfig((c) => ({ ...c, calculator: v }))} label="Calculator allowed" description={config.calculator ? 'Calculator questions included' : 'No-calculator questions only'} />
        <div><p className="mb-2 text-sm font-semibold">Question types</p><div className="flex flex-wrap gap-2">{[['mc', 'Multiple choice'], ['short', 'Short answer'], ['written', 'Written response']].map(([id, l]) => <Chip key={id} selected={config.formats.includes(id)} onClick={() => setConfig((c) => ({ ...c, formats: c.formats.includes(id) ? c.formats.filter((x) => x !== id) : [...c.formats, id] }))}>{l}</Chip>)}</div></div>
        <Button size="lg" loading={busy} disabled={!planId && !skills.length} onClick={() => start()}>Start mock test</Button>
      </Card>
    </div>
  );
}
