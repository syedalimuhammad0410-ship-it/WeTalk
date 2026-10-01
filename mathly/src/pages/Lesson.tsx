import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ExternalLink, Lightbulb, Mic, MicOff, Sparkles, Globe } from 'lucide-react';
import type { PublicQuestion, VisualSpec } from '../../shared/types.ts';
import { useFetch, useApp } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { celebrate, confettiBurst, toast } from '../lib/celebrate.ts';
import { openTutor } from '../lib/tutorBus.ts';
import { speechSupported, useDictation } from '../lib/speech.ts';
import { QuestionCard, StepLine, type AnswerResult } from '../components/QuestionCard.tsx';
import { MathVisual } from '../components/MathVisual.tsx';
import { Badge, Button, Card, ErrorState, PageSkeleton, Progress, RichText, Spinner, Textarea, cx } from '../components/ui.tsx';

const STAGES = [
  { id: 'learn', label: 'Learn' }, { id: 'example', label: 'Example' }, { id: 'try', label: 'Try it' }, { id: 'practice', label: 'Practice' },
  { id: 'challenge', label: 'Challenge' }, { id: 'explain', label: 'Explain it' }, { id: 'check', label: 'Quick check' },
] as const;
type StageId = (typeof STAGES)[number]['id'] | 'done';
const COUNTS: Record<string, number> = { try: 1, practice: 3, challenge: 1, check: 2 };

interface LessonData {
  lesson: {
    key: string; kind: 'skill' | 'generated'; courseId?: string; title?: string; aiGenerated?: boolean;
    skill: { id: string; title: string; summary: string; learn: string[]; keyIdea: string; realWorld: string; explainPrompt: string; explainKeywords: string[]; domainName: string; gradeLabel: string; visual?: boolean };
    example: { prompt: string; steps: string[]; answer: string; unit?: string; visual?: VisualSpec; explanation?: string };
    prereqs: { id: string; title: string; mastery: number }[]; mastery: { effective: number } | null;
  };
  progress: { stage: string; status: string } | null;
}
interface Resource { id: string; title: string; url: string; source: string; kind: string; why?: string }

export default function Lesson() {
  const { lessonId, courseId: routeCourse } = useParams();
  const [params] = useSearchParams();
  const courseId = routeCourse ?? params.get('course') ?? undefined;
  const { data, error, loading, reload } = useFetch<LessonData>(`/me/lessons/${lessonId}${routeCourse ? `?course=${routeCourse}` : ''}`);
  const { profile } = useApp();
  const nav = useNavigate();
  const [stage, setStage] = useState<StageId>('learn');
  const [stepShown, setStepShown] = useState(1);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [answeredInStage, setAnsweredInStage] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [done, setDone] = useState<{ xp: number; next: { skillId: string; title: string } | null; score: number } | null>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const generated = data?.lesson.kind === 'generated';

  useEffect(() => { if (data?.progress && data.progress.status !== 'completed' && STAGES.some((s) => s.id === data.progress!.stage)) setStage(data.progress.stage as StageId); }, [data?.progress]);
  const saveStage = useCallback((s: StageId, extra: Record<string, unknown> = {}) => post<{ xp: number; achievements: never[]; levelUp: number | null; next: { skillId: string; title: string } | null }>(`/me/lessons/${lessonId}/progress`, { stage: s === 'done' ? 'done' : s, courseId: generated ? courseId : undefined, ...extra }), [lessonId, generated, courseId]);

  const loadQuestion = useCallback(async (s: StageId) => {
    if (!data) return;
    setLoadingQ(true); setQuestion(null);
    try {
      const body = generated ? { courseId: data.lesson.courseId, lessonId, stage: s, mode: 'lesson' } : { skillId: data.lesson.skill.id, stage: s, mode: 'lesson' };
      const r = await post<{ question: PublicQuestion }>('/me/questions/next', body);
      setQuestion(r.question);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setLoadingQ(false); }
  }, [data, generated, lessonId]);

  useEffect(() => { setAnsweredInStage(0); if (['try', 'practice', 'challenge', 'check'].includes(stage)) loadQuestion(stage); else setQuestion(null); }, [stage, loadQuestion]);

  function go(s: StageId) { setStage(s); saveStage(s).catch(() => {}); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const idx = STAGES.findIndex((s) => s.id === stage);
  const nextStage = () => (idx < STAGES.length - 1 ? go(STAGES[idx + 1].id) : finish());

  async function finish() {
    const pct = score.total ? Math.round((score.correct / score.total) * 100) : 100;
    try {
      const r = await saveStage('done', { complete: true, score: pct });
      celebrate(r); confettiBurst(true);
      setDone({ xp: r.xp, next: r.next, score: pct }); setStage('done');
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  function onAnswered(r: AnswerResult) {
    if (r.attempts === 1 && (stage === 'practice' || stage === 'check' || stage === 'challenge')) setScore((s) => ({ correct: s.correct + (r.correct ? 1 : 0), total: s.total + 1 }));
  }
  function afterQuestion() {
    const n = answeredInStage + 1;
    if (n >= (COUNTS[stage] ?? 1)) nextStage(); else { setAnsweredInStage(n); loadQuestion(stage); }
  }

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Lesson not found.'} onRetry={reload} />;
  const L = data.lesson; const sk = L.skill;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => (courseId ? nav(`/learn/${courseId}`) : nav(-1))} className="rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold uppercase tracking-wider text-muted">{sk.domainName}{sk.gradeLabel ? ` · ${sk.gradeLabel}` : ''}</p><h1 className="truncate text-xl font-extrabold sm:text-2xl">{sk.title}</h1></div>
        {L.aiGenerated && <Badge tone="warn">AI-generated lesson</Badge>}
      </div>
      {stage !== 'done' && (
        <nav className="scrollbar-thin mb-6 flex gap-1.5 overflow-x-auto pb-1" aria-label="Lesson stages">
          {STAGES.map((s, i) => (
            <button key={s.id} onClick={() => go(s.id)} aria-current={stage === s.id ? 'step' : undefined} className={cx('flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition', stage === s.id ? 'bg-brand text-white' : i < idx ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted hover:text-text')}>
              {i < idx ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs">{i + 1}</span>}{s.label}
            </button>
          ))}
        </nav>
      )}

      <AnimatePresence mode="wait">
        <motion.div key={stage} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
          {stage === 'learn' && (
            <div className="space-y-4">
              <Card className="p-6 sm:p-8">
                <p className="text-sm font-semibold text-accent"><BookOpen className="mr-1 inline h-4 w-4" />Learn</p>
                <p className="mt-2 text-lg font-semibold">{sk.summary}</p>
                <div className="mt-4 space-y-3 text-[1.02rem] leading-relaxed">{sk.learn.map((p, i) => <RichText key={i} text={p} />)}</div>
                <div className="mt-6 rounded-2xl bg-accent-soft p-5"><p className="text-xs font-bold uppercase tracking-wider text-accent">Key idea</p><p className="math mt-1 text-xl font-bold">{sk.keyIdea}</p></div>
                {L.example.visual && <div className="mt-6"><MathVisual spec={L.example.visual} /></div>}
                {sk.realWorld && <p className="mt-5 flex items-start gap-2 text-sm text-muted"><Globe className="mt-0.5 h-4 w-4 shrink-0" /><span><strong className="text-text">Real world: </strong>{sk.realWorld}</span></p>}
              </Card>
              <ThinkFramework />
              {!generated && <LessonResources skillId={sk.id} />}
              {L.prereqs.some((p) => p.mastery < 55) && <Card className="p-4 text-sm"><Lightbulb className="mr-1 inline h-4 w-4 text-warn" />This builds on {L.prereqs.filter((p) => p.mastery < 55).map((p, i) => <span key={p.id}>{i ? ', ' : ''}<Link className="font-semibold text-accent" to={`/lesson/${p.id}`}>{p.title}</Link></span>)}. A quick review might help first.</Card>}
              <StageNav onNext={nextStage} onTutor={() => openTutor({ skillId: generated ? undefined : sk.id, lessonStage: 'learn', prompt: `Explain ${sk.title} in a different way.` })} />
            </div>
          )}
          {stage === 'example' && (
            <div className="space-y-4">
              <Card className="p-6 sm:p-8">
                <p className="text-sm font-semibold text-accent"><Sparkles className="mr-1 inline h-4 w-4" />Worked example</p>
                <div className="mt-3 text-lg font-semibold"><RichText text={L.example.prompt} /></div>
                {L.example.visual && <div className="my-4"><MathVisual spec={L.example.visual} /></div>}
                <ol className="mt-5 space-y-2.5">
                  {L.example.steps.slice(0, stepShown).map((s, i) => <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="rounded-xl bg-surface-2 p-3"><StepLine s={s} /></motion.li>)}
                </ol>
                {stepShown < L.example.steps.length ? <Button variant="soft" className="mt-4" onClick={() => setStepShown((n) => n + 1)}>Show next step ({stepShown}/{L.example.steps.length})</Button>
                  : <div className="mt-4 rounded-2xl bg-success-soft p-4"><p className="font-bold">Answer: {L.example.answer}{L.example.unit ? ` ${L.example.unit}` : ''}</p>{L.example.explanation && <p className="mt-1 text-sm">{L.example.explanation}</p>}</div>}
              </Card>
              <StageNav onBack={() => go('learn')} onNext={nextStage} nextDisabled={stepShown < L.example.steps.length} onTutor={() => openTutor({ skillId: generated ? undefined : sk.id, prompt: `Why does this step work in the example: ${L.example.prompt}` })} />
            </div>
          )}
          {['try', 'practice', 'challenge', 'check'].includes(stage) && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-muted">{stage === 'try' ? 'Your turn — have a go. Help is available if you need it.' : stage === 'practice' ? `Practice ${answeredInStage + 1} of ${COUNTS.practice}` : stage === 'challenge' ? 'Challenge — a harder problem. Take your time.' : `Quick check ${answeredInStage + 1} of ${COUNTS.check} — no hints this time.`}</p>
              {loadingQ || !question ? <Card className="p-8"><Spinner /></Card> : <QuestionCard question={question} mode="lesson" lessonStage={stage} onAnswered={onAnswered} onNext={afterQuestion} nextLabel={answeredInStage + 1 >= (COUNTS[stage] ?? 1) ? 'Continue' : 'Next question'} hideHelp={stage === 'check'} askConfidence={stage === 'check' && profile?.ageBand !== 'early'} />}
              <div className="flex justify-between"><Button variant="ghost" onClick={() => go(STAGES[idx - 1].id)} icon={<ArrowLeft className="h-4 w-4" />}>Back</Button><Button variant="ghost" onClick={nextStage}>Skip<ArrowRight className="h-4 w-4" /></Button></div>
            </div>
          )}
          {stage === 'explain' && <ExplainStage skillId={sk.id} prompt={sk.explainPrompt} keywords={sk.explainKeywords} onNext={nextStage} onBack={() => go('challenge')} />}
          {stage === 'done' && done && (
            <Card className="p-8 text-center">
              <motion.div initial={{ scale: 0.5, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} className="text-7xl">🎉</motion.div>
              <h2 className="mt-4 text-3xl font-extrabold">Lesson complete!</h2>
              <p className="mt-2 text-muted">You scored {done.score}% on practice and the quick check{done.xp ? ` and earned +${done.xp} XP` : ''}.</p>
              <div className="mx-auto mt-6 max-w-sm"><Progress value={done.score} tone={done.score >= 70 ? 'success' : 'warn'} /></div>
              <p className="mt-3 text-sm text-muted">{done.score >= 70 ? 'Great work — your mastery went up.' : 'You’re still building this skill. A bit more practice will lock it in.'}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {done.next && <Button onClick={() => nav(`/lesson/${done.next!.skillId}`)}>Next: {done.next.title}<ArrowRight className="h-4 w-4" /></Button>}
                {done.score < 70 && !generated && <Button variant="secondary" onClick={() => nav(`/practice/session?skill=${sk.id}&mode=targeted`)}>Targeted practice</Button>}
                {courseId && <Button variant="secondary" onClick={() => nav(`/learn/${courseId}`)}>Back to course</Button>}
                <Button variant="ghost" onClick={() => nav('/')}>Dashboard</Button>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StageNav({ onNext, onBack, nextDisabled, onTutor }: { onNext: () => void; onBack?: () => void; nextDisabled?: boolean; onTutor?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-2">{onBack && <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>Back</Button>}{onTutor && <Button variant="ghost" onClick={onTutor}>Explain it differently</Button>}</div>
      <Button size="lg" onClick={onNext} disabled={nextDisabled}>Continue<ArrowRight className="h-4 w-4" /></Button>
    </div>
  );
}

function ThinkFramework() {
  const steps = [['Understand', 'What is the problem asking?'], ['Plan', 'Which method or formula fits?'], ['Solve', 'Carry out the math step by step.'], ['Check', 'Does the answer make sense?'], ['Communicate', 'Explain the result clearly.']];
  return (
    <Card className="p-5">
      <p className="mb-3 text-sm font-bold">How to think about any problem</p>
      <div className="grid gap-2 sm:grid-cols-5">{steps.map(([t, d], i) => <div key={t} className="rounded-2xl bg-surface-2 p-3"><p className="text-xs font-bold text-accent">{i + 1}. {t.toUpperCase()}</p><p className="mt-1 text-xs text-muted">{d}</p></div>)}</div>
    </Card>
  );
}

function LessonResources({ skillId }: { skillId: string }) {
  const { data } = useFetch<{ resources: Resource[] }>(`/me/resources?skill=${skillId}`);
  if (!data?.resources.length) return null;
  return (
    <Card className="p-5">
      <p className="mb-1 text-sm font-bold">Want another explanation?</p>
      <p className="mb-3 text-xs text-muted">External resources from trusted sources (they open on another website).</p>
      <ul className="space-y-2">{data.resources.slice(0, 3).map((r) => <li key={r.id}><a href={r.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 rounded-xl p-2 hover:bg-surface-2"><ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span><span className="font-semibold">{r.title}</span> <Badge>{r.kind}</Badge><span className="block text-xs text-muted">External · {r.source}{r.why ? ` — ${r.why}` : ''}</span></span></a></li>)}</ul>
    </Card>
  );
}

function ExplainStage({ skillId, prompt, keywords, onNext, onBack }: { skillId: string; prompt: string; keywords: string[]; onNext: () => void; onBack: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ score: number; feedback: string; matched: string[]; missing: string[] } | null>(null);
  const dict = useDictation({ onFinal: (t) => setText((cur) => `${cur}${cur ? ' ' : ''}${t}`) });
  async function submit() {
    setBusy(true);
    try { const r = await post<{ score: number; feedback: string; matched: string[]; missing: string[]; xp: number; achievements: never[] }>('/me/explain', { skillId, text }); setRes(r); celebrate(r); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <Card className="p-6 sm:p-8">
        <p className="text-sm font-semibold text-accent">Explain it</p>
        <h2 className="mt-2 text-xl font-bold">{prompt}</h2>
        <p className="mt-1 text-sm text-muted">Explaining in your own words is one of the best ways to learn. Type or speak your answer.</p>
        <div className="mt-4"><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="In my own words…" aria-label="Your explanation" maxLength={3000} /></div>
        {dict.interim && <p className="mt-1 text-sm text-accent">🎙️ {dict.interim}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button loading={busy} disabled={text.trim().split(/\s+/).length < 3} onClick={submit}>Get feedback</Button>
          {speechSupported() && <Button variant="secondary" icon={dict.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} onClick={() => (dict.listening ? dict.stop() : dict.start())}>{dict.listening ? 'Stop' : 'Speak'}</Button>}
        </div>
        {res && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-2xl bg-surface-2 p-4">
            <div className="flex items-center gap-3"><span className="text-2xl font-extrabold">{res.score}</span><span className="text-sm text-muted">/ 100 explanation score</span></div>
            <p className="mt-2">{res.feedback}</p>
            {keywords.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{keywords.map((k) => <Badge key={k} tone={res.matched.includes(k) ? 'success' : 'neutral'}>{res.matched.includes(k) ? '✓ ' : ''}{k}</Badge>)}</div>}
          </motion.div>
        )}
      </Card>
      <div className="flex justify-between"><Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>Back</Button><Button size="lg" onClick={onNext}>{res ? 'Continue' : 'Skip for now'}<ArrowRight className="h-4 w-4" /></Button></div>
    </div>
  );
}
