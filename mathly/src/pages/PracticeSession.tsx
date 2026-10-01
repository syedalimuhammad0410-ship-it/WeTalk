import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Heart, Timer, Trophy } from 'lucide-react';
import type { PublicQuestion } from '../../shared/types.ts';
import { SKILL_MAP } from '../../shared/skills.ts';
import { post, errMsg } from '../lib/api.ts';
import { confettiBurst, toast } from '../lib/celebrate.ts';
import { openTutor } from '../lib/tutorBus.ts';
import { QuestionCard, type AnswerResult } from '../components/QuestionCard.tsx';
import { Badge, Button, Card, ErrorState, Progress, Spinner } from '../components/ui.tsx';
import { MODES } from './Practice.tsx';

const SESSION = 10;
const SPEED_SECONDS = 60;
const best = (k: string) => { try { return Number(localStorage.getItem(`mathly.best.${k}`) ?? 0); } catch { return 0; } };
const setBest = (k: string, v: number) => { try { localStorage.setItem(`mathly.best.${k}`, String(v)); } catch { /* ignore */ } };

export default function PracticeSession() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const mode = params.get('mode') ?? 'practice';
  const skill = params.get('skill') ?? undefined;
  const meta = MODES.find((m) => m.id === mode) ?? (mode === 'targeted' ? { icon: '🎯', title: 'Targeted Practice' } : MODES[0]);
  const [q, setQ] = useState<PublicQuestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [stats, setStats] = useState({ correct: 0, answered: 0, xp: 0, combo: 0, bestCombo: 0 });
  const [lives, setLives] = useState(3);
  const [timeLeft, setTimeLeft] = useState(SPEED_SECONDS);
  const [finished, setFinished] = useState(false);
  const [quick, setQuick] = useState('');
  const timed = mode === 'speed';
  const game = mode === 'game';
  const fast = timed || game || mode === 'mental';
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await post<{ question: PublicQuestion }>('/me/questions/next', { mode, skillId: skill }); setQ(r.question); setQuick(''); } catch (e) { setError(errMsg(e)); }
  }, [mode, skill]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!timed || finished) return;
    timer.current = setInterval(() => setTimeLeft((t) => { if (t <= 1) { setFinished(true); return 0; } return t - 1; }), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [timed, finished]);
  useEffect(() => { if (mode === 'tutor' && q) openTutor({ questionId: q.id, skillId: q.skillId, helpLevel: 1, prompt: 'Let’s work through this problem together. Ask me what I think the first step is.' }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, q?.id]);

  function record(r: AnswerResult) {
    if (r.attempts > 1 && !r.correct) return;
    setStats((s) => {
      const first = r.attempts === 1;
      const combo = r.correct && first ? s.combo + 1 : 0;
      return { correct: s.correct + (r.correct && first ? 1 : 0), answered: s.answered + (first ? 1 : 0), xp: s.xp + r.xp, combo, bestCombo: Math.max(s.bestCombo, combo) };
    });
    if (game && !r.correct && r.attempts === 1) setLives((l) => { if (l <= 1) setTimeout(() => setFinished(true), 600); return l - 1; });
    if (game && r.correct && (stats.combo + 1) % 5 === 0) confettiBurst();
  }
  function next() {
    const k = n + 1; setN(k);
    if (!timed && !game && k >= SESSION) { setFinished(true); return; }
    load();
  }
  // Fast modes use a compact inline answer box: submit → immediately next question.
  async function quickSubmit() {
    if (!q || !quick.trim()) return;
    try {
      const r = await post<AnswerResult>(`/me/questions/${q.id}/answer`, { response: quick, mode });
      record({ ...r, attempts: 1 });
      if (!r.correct) toast(`${r.feedback}${r.solution ? ` Answer: ${r.solution.answer}` : ''}`, 'info');
      if (!(game && !r.correct && lives <= 1)) { setN((x) => x + 1); load(); }
    } catch (e) { toast(errMsg(e), 'error'); }
  }

  const score = stats.correct * 10 + stats.bestCombo * 5;
  useEffect(() => { if (finished && (timed || game)) { const k = mode; if (score > best(k)) { setBest(k, score); if (score > 0) confettiBurst(true); } } }, [finished, timed, game, mode, score]);

  if (finished) {
    const acc = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
    return (
      <Card className="mx-auto max-w-lg p-8 text-center">
        <Trophy className="mx-auto h-14 w-14 text-warn" />
        <h1 className="mt-4 text-3xl font-extrabold">{game ? (lives <= 0 ? 'Game over!' : 'Great run!') : timed ? 'Time’s up!' : 'Session complete!'}</h1>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-surface-2 p-3"><div className="text-2xl font-extrabold">{stats.correct}/{stats.answered}</div><div className="text-xs text-muted">Correct</div></div>
          <div className="rounded-2xl bg-surface-2 p-3"><div className="text-2xl font-extrabold">{acc}%</div><div className="text-xs text-muted">Accuracy</div></div>
          <div className="rounded-2xl bg-surface-2 p-3"><div className="text-2xl font-extrabold">+{stats.xp}</div><div className="text-xs text-muted">XP</div></div>
        </div>
        {(timed || game) && <p className="mt-4 font-semibold">Score {score} · Best {Math.max(best(mode), score)} · Best combo ×{stats.bestCombo}</p>}
        <p className="mt-3 text-sm text-muted">{acc >= 80 ? 'Excellent — you’re mastering this.' : acc >= 50 ? 'Solid progress. Keep going!' : 'You’re still building these skills — every attempt helps.'}</p>
        <div className="mt-6 flex justify-center gap-2"><Button onClick={() => { setFinished(false); setN(0); setStats({ correct: 0, answered: 0, xp: 0, combo: 0, bestCombo: 0 }); setLives(3); setTimeLeft(SPEED_SECONDS); load(); }}>Play again</Button><Button variant="secondary" onClick={() => nav('/practice')}>Other modes</Button></div>
      </Card>
    );
  }
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={() => nav('/practice')} className="rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="Back to practice"><ArrowLeft className="h-5 w-5" /></button>
        <span className="text-2xl">{meta.icon}</span>
        <div className="mr-auto"><h1 className="text-xl font-extrabold">{meta.title}</h1>{skill && <p className="text-sm text-muted">{SKILL_MAP[skill]?.title}</p>}</div>
        {timed && <Badge tone={timeLeft <= 10 ? 'danger' : 'accent'} className="text-base"><Timer className="h-4 w-4" />{timeLeft}s</Badge>}
        {game && <span className="flex gap-0.5" aria-label={`${lives} lives`}>{[0, 1, 2].map((i) => <Heart key={i} className={`h-6 w-6 ${i < lives ? 'fill-danger text-danger' : 'text-border'}`} />)}</span>}
        {(game || timed) && <Badge tone="warn" className="text-base">×{stats.combo} combo</Badge>}
        <Badge tone="success" className="text-base">{stats.correct} ✓</Badge>
      </div>
      {!timed && !game && <div className="mb-5 flex items-center gap-3"><Progress value={(n / SESSION) * 100} label="Session progress" /><span className="text-sm font-bold text-muted">{Math.min(n + 1, SESSION)}/{SESSION}</span></div>}
      {timed && <div className="mb-5"><Progress value={(timeLeft / SPEED_SECONDS) * 100} tone={timeLeft <= 10 ? 'warn' : 'accent'} label="Time left" /></div>}
      {error && <ErrorState message={error} onRetry={load} />}
      {!q && !error && <Card className="p-10"><Spinner /></Card>}
      <AnimatePresence mode="wait">
        {q && (
          <motion.div key={q.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>
            {fast && q.answerType !== 'choice' ? (
              <Card className="p-6 text-center">
                <p className="text-sm font-semibold text-muted">{SKILL_MAP[q.skillId]?.title}</p>
                <p className="math mt-3 text-3xl font-extrabold sm:text-4xl">{q.prompt.replace(/^Mental math:\s*/, '')}</p>
                <form onSubmit={(e) => { e.preventDefault(); quickSubmit(); }} className="mx-auto mt-6 flex max-w-sm gap-2">
                  <input autoFocus value={quick} onChange={(e) => setQuick(e.target.value)} inputMode={q.answerType === 'number' ? 'decimal' : 'text'} aria-label="Your answer" className="h-14 flex-1 rounded-2xl border-2 border-border bg-surface px-4 text-center text-2xl font-bold outline-none focus:border-accent" />
                  <Button type="submit" size="lg" disabled={!quick.trim()}>Go</Button>
                </form>
                {q.unit && <p className="mt-2 text-sm text-muted">Answer in {q.unit}</p>}
                <button className="mt-4 text-sm font-semibold text-muted hover:text-text" onClick={() => { setN((x) => x + 1); load(); }}>Skip →</button>
              </Card>
            ) : (
              <QuestionCard question={q} mode={mode} onAnswered={record} onNext={next} askConfidence={mode === 'practice' && n % 3 === 2} nextLabel={!timed && !game && n + 1 >= SESSION ? 'Finish' : 'Next question'} hideHelp={timed || game} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
