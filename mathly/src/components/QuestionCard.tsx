import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Brain, Check, ChevronRight, Flag, Footprints, HelpCircle, Lightbulb, MessageCircle, Sparkles, Eye, RotateCcw } from 'lucide-react';
import type { PublicQuestion } from '../../shared/types.ts';
import { SKILL_MAP } from '../../shared/skills.ts';
import { post, errMsg } from '../lib/api.ts';
import { celebrate, confettiBurst, toast, type Achievement } from '../lib/celebrate.ts';
import { openTutor } from '../lib/tutorBus.ts';
import { useApp } from '../lib/store.tsx';
import { Badge, Button, Card, Modal, RichText, Textarea, cx } from './ui.tsx';
import { MathVisual } from './MathVisual.tsx';

export interface AnswerResult {
  correct: boolean; feedback: string; mistakeType?: string; nudge?: boolean; attempts: number;
  solution: { answer: string; unit?: string; steps: string[]; explanation: string } | null;
  xp: number; mastery: { before: number; after: number } | null; learningLevel: number | null; achievements: Achievement[]; levelUp: number | null; alreadySolved?: boolean;
}
interface HelpContent { level: number; kind: string; title: string; text?: string; example?: { prompt: string; steps: string[]; answer: string; unit?: string }; solution?: { answer: string; unit?: string; steps: string[]; explanation: string } }

const LADDER = [
  { level: 1, label: 'Think', icon: Brain }, { level: 2, label: 'Hint', icon: Lightbulb }, { level: 3, label: 'Concept', icon: BookOpen },
  { level: 4, label: 'Next step', icon: Footprints }, { level: 5, label: 'Example', icon: Sparkles }, { level: 6, label: 'Solution', icon: Eye },
];
const CONFIDENCE = [{ v: 0, e: '😰', l: 'Not confident' }, { v: 1, e: '😐', l: 'Okay' }, { v: 2, e: '🙂', l: 'Comfortable' }, { v: 3, e: '😎', l: 'Very confident' }];
const PLACEHOLDER: Record<string, string> = { number: 'Your answer', fraction: 'e.g. 3/4', expression: 'e.g. 6x^2 - 4', antiderivative: 'e.g. x^3/3 + 2x', set: 'e.g. 2, -3', pair: 'e.g. (2, -1)', text: 'Your answer', choice: '' };
const KEYS = ['²', '√', 'π', '^', '/', '(', ')', '−', 'x'];

export function QuestionCard({ question, mode = 'practice', onAnswered, onNext, nextLabel = 'Next question', askConfidence = false, compact = false, hideHelp = false, lessonStage }: {
  question: PublicQuestion; mode?: string; onAnswered?: (r: AnswerResult) => void; onNext?: () => void; nextLabel?: string; askConfidence?: boolean; compact?: boolean; hideHelp?: boolean; lessonStage?: string;
}) {
  const { prefs, profile } = useApp();
  const [value, setValue] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<HelpContent[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmSolution, setConfirmSolution] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const started = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const skill = SKILL_MAP[question.skillId];
  const done = !!result && (result.correct || !!result.solution);
  const learningMode = prefs.learningMode !== false;
  const kid = profile?.ageBand === 'early';

  useEffect(() => { setValue(''); setResult(null); setHelp([]); setHelpOpen(false); setConfidence(null); started.current = Date.now(); setTimeout(() => inputRef.current?.focus(), 50); }, [question.id]);

  async function submit(answer = value) {
    if (!answer.trim() || busy || done) return;
    setBusy(true);
    try {
      const r = await post<AnswerResult>(`/me/questions/${question.id}/answer`, { response: answer, timeMs: Date.now() - started.current, confidence, mode });
      setResult(r);
      if (r.correct) { if (!r.achievements?.length && !r.levelUp && (question.difficulty >= 4 || mode === 'daily')) confettiBurst(); }
      celebrate(r);
      onAnswered?.(r);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }

  async function getHelp(level: number) {
    if (level === 6 && !confirmSolution && learningMode) { setConfirmSolution(true); return; }
    setConfirmSolution(false);
    try {
      const h = await post<HelpContent>(`/me/questions/${question.id}/help`, { level });
      setHelp((cur) => [...cur.filter((x) => x.level !== level), h].sort((a, b) => a.level - b.level));
    } catch (e) { toast(errMsg(e), 'error'); }
  }

  const insert = (k: string) => {
    const map: Record<string, string> = { '²': '^2', '√': 'sqrt(', 'π': 'pi', '−': '-' };
    setValue((v) => v + (map[k] ?? k)); inputRef.current?.focus();
  };
  const maxHelp = help.reduce((m, h) => Math.max(m, h.level), 0);

  return (
    <Card className={cx('overflow-hidden', compact ? 'p-5' : 'p-5 sm:p-7')}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {skill && <Badge tone="accent">{skill.title}</Badge>}
        {question.source === 'ai' && <Badge tone="warn">AI-generated · verified</Badge>}
        <span className="flex items-center gap-0.5" aria-label={`Difficulty ${question.difficulty} of 5`} title={`Difficulty ${question.difficulty}/5`}>
          {Array.from({ length: 5 }, (_, i) => <span key={i} className={cx('h-1.5 w-4 rounded-full', i < question.difficulty ? 'bg-accent' : 'bg-surface-2')} />)}
        </span>
        <button onClick={() => setFlagOpen(true)} className="ml-auto rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text" aria-label="Report a problem with this question" title="Report a problem"><Flag className="h-4 w-4" /></button>
      </div>

      {question.context && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Real-world · {question.context}</p>}
      <div className={cx('font-semibold', kid ? 'text-2xl' : 'text-lg sm:text-xl')}><RichText text={question.prompt} /></div>
      {question.visual && <div className="my-5"><MathVisual spec={question.visual} /></div>}

      <div className="mt-5">
        {question.answerType === 'choice' && question.choices ? (
          <div className={cx('grid gap-2.5', question.choices.length > 2 ? 'sm:grid-cols-2' : 'grid-cols-2')}>
            {question.choices.map((c) => {
              const picked = value === c; const isAnswer = done && result?.solution?.answer === c;
              return (
                <button key={c} disabled={done || busy} onClick={() => { setValue(c); if (!askConfidence) submit(c); }} className={cx('min-h-14 rounded-2xl border-2 px-4 py-3 text-left font-semibold transition-all active:scale-[0.98]', kid && 'text-center text-3xl', isAnswer ? 'border-success bg-success-soft' : picked && result && !result.correct ? 'border-warn bg-warn-soft' : picked ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-accent/60')}>
                  {c}
                </button>
              );
            })}
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} disabled={done} placeholder={PLACEHOLDER[question.answerType]} aria-label="Your answer"
                  inputMode={question.answerType === 'number' ? 'decimal' : 'text'} autoComplete="off" autoCapitalize="off" spellCheck={false}
                  className={cx('h-14 w-full rounded-2xl border-2 bg-surface px-4 text-lg font-semibold outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15', result && !result.correct && !done ? 'border-warn' : done && result?.correct ? 'border-success' : 'border-border', question.unit && 'pr-16')} />
                {question.unit && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-semibold text-muted">{question.unit}</span>}
              </div>
              {!askConfidence && <Button type="submit" size="lg" loading={busy} disabled={!value.trim() || done} aria-label="Check answer"><Check className="h-5 w-5" /><span className="hidden sm:inline">Check</span></Button>}
            </div>
            {['expression', 'antiderivative', 'set', 'fraction', 'number', 'pair'].includes(question.answerType) && !done && (
              <div className="flex flex-wrap gap-1.5" aria-label="Math symbols">
                {KEYS.filter((k) => question.answerType === 'expression' || question.answerType === 'antiderivative' || !['x', '^'].includes(k)).map((k) => <button type="button" key={k} onClick={() => insert(k)} className="h-9 min-w-9 rounded-xl border border-border bg-surface-2 px-2 font-semibold hover:border-accent">{k}</button>)}
              </div>
            )}
          </form>
        )}
      </div>

      {askConfidence && !done && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold text-muted">How confident are you?</p>
          <div className="flex flex-wrap gap-2">
            {CONFIDENCE.map((c) => <button key={c.v} type="button" onClick={() => setConfidence(c.v)} className={cx('flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-semibold transition', confidence === c.v ? 'border-accent bg-accent-soft text-accent' : 'border-border hover:border-accent/50')}><span className="text-lg">{c.e}</span>{c.l}</button>)}
          </div>
          <Button className="mt-4 w-full sm:w-auto" size="lg" loading={busy} disabled={!value.trim()} onClick={() => submit()}>Check answer</Button>
        </div>
      )}

      <AnimatePresence>
        {result && (
          <motion.div key={`${result.attempts}-${result.correct}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cx('mt-5 rounded-2xl p-4', result.correct ? 'bg-success-soft' : 'bg-warn-soft')} role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              <div className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg text-white', result.correct ? 'bg-success' : 'bg-warn')}>{result.correct ? '✓' : '↻'}</div>
              <div className="min-w-0 flex-1">
                <p className="font-bold">{result.feedback}</p>
                {result.xp > 0 && <p className="text-sm font-semibold text-success">+{result.xp} XP</p>}
                {result.mastery && result.mastery.after !== result.mastery.before && <p className="text-sm text-muted">Mastery {result.mastery.before}% → {result.mastery.after}%</p>}
                {!result.correct && !result.solution && <p className="mt-1 text-sm text-muted">Attempt {result.attempts} of 3 — try again, or use the help ladder below.</p>}
              </div>
            </div>
            {result.solution && (
              <div className="mt-4 space-y-2 rounded-xl bg-surface p-4">
                {!result.correct && <p className="font-semibold">Here’s how it works — the answer is <span className="text-accent">{result.solution.answer}{result.solution.unit ? ` ${result.solution.unit}` : ''}</span>.</p>}
                <ol className="space-y-1.5 text-sm">{result.solution.steps.map((s, i) => <li key={i} className="math"><StepLine s={s} /></li>)}</ol>
                <p className="border-t border-border pt-2 text-sm"><span className="font-semibold">Communicate: </span>{result.solution.explanation}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!hideHelp && !done && (
        <div className="mt-5">
          {!helpOpen ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="soft" size="sm" icon={<HelpCircle className="h-4 w-4" />} onClick={() => { setHelpOpen(true); if (!help.length) getHelp(1); }}>Need help?</Button>
              <Button variant="ghost" size="sm" icon={<MessageCircle className="h-4 w-4" />} onClick={() => openTutor({ questionId: question.id, skillId: question.skillId, studentAnswer: value || undefined, helpLevel: Math.max(1, maxHelp), lessonStage })}>Ask tutor</Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{learningMode ? 'Learning Mode: I’ll help you understand it without immediately giving the answer.' : 'Help ladder'}</p>
                <Button variant="ghost" size="sm" icon={<MessageCircle className="h-4 w-4" />} onClick={() => openTutor({ questionId: question.id, skillId: question.skillId, studentAnswer: value || undefined, helpLevel: Math.max(1, maxHelp), lessonStage })}>Tutor</Button>
              </div>
              <div className="scrollbar-thin -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {LADDER.map(({ level, label, icon: Icon }) => (
                  <button key={level} onClick={() => getHelp(level)} disabled={level > maxHelp + 1} className={cx('flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition', help.some((h) => h.level === level) ? 'border-accent bg-accent-soft text-accent' : level === maxHelp + 1 ? 'border-accent/50 hover:bg-accent-soft' : 'border-border text-muted opacity-60')}>
                    <Icon className="h-3.5 w-3.5" />{level}. {label}
                  </button>
                ))}
              </div>
              {confirmSolution && (
                <div className="mb-3 rounded-xl bg-warn-soft p-3 text-sm">
                  <p className="font-semibold">Show the full solution?</p>
                  <p className="text-muted">You’ll learn more by trying the next step, and this question won’t earn full XP. It’s still a great way to review.</p>
                  <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => setConfirmSolution(false)}>Keep trying</Button><Button size="sm" onClick={() => { setConfirmSolution(false); post<HelpContent>(`/me/questions/${question.id}/help`, { level: 6 }).then((h) => setHelp((c) => [...c.filter((x) => x.level !== 6), h])); }}>Show full solution</Button></div>
                </div>
              )}
              <div className="space-y-3">
                {help.map((h) => (
                  <motion.div key={h.level} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-surface-2 p-3 text-sm">
                    <p className="mb-1 font-bold">{h.title}</p>
                    {h.text && <RichText text={h.text} />}
                    {h.example && <div><p className="font-semibold">{h.example.prompt}</p><ol className="mt-1 space-y-1">{h.example.steps.map((s, i) => <li key={i}><StepLine s={s} /></li>)}</ol><p className="mt-1">Answer: <strong>{h.example.answer}{h.example.unit ? ` ${h.example.unit}` : ''}</strong></p></div>}
                    {h.solution && <div><ol className="space-y-1">{h.solution.steps.map((s, i) => <li key={i}><StepLine s={s} /></li>)}</ol><p className="mt-1">Answer: <strong>{h.solution.answer}{h.solution.unit ? ` ${h.solution.unit}` : ''}</strong></p><p className="mt-1 text-muted">{h.solution.explanation}</p></div>}
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {done && onNext && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="lg" onClick={onNext} className="flex-1 sm:flex-none">{nextLabel}<ChevronRight className="h-5 w-5" /></Button>
          {!result?.correct && <Button size="lg" variant="secondary" icon={<MessageCircle className="h-4 w-4" />} onClick={() => openTutor({ questionId: question.id, skillId: question.skillId, studentAnswer: value, helpLevel: 6 })}>Why was I wrong?</Button>}
        </div>
      )}
      {result && !result.correct && !result.solution && (
        <button className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent" onClick={() => { setValue(''); setResult(null); inputRef.current?.focus(); }}><RotateCcw className="h-3.5 w-3.5" />Clear and try again</button>
      )}
      <FlagModal open={flagOpen} onClose={() => setFlagOpen(false)} questionId={question.id} />
    </Card>
  );
}

export function StepLine({ s }: { s: string }) {
  const m = s.match(/^(UNDERSTAND|PLAN|SOLVE|CHECK|COMMUNICATE):\s*(.*)$/s);
  if (!m) return <span className="math">{s}</span>;
  const color: Record<string, string> = { UNDERSTAND: 'bg-sky-500/15 text-sky-600 dark:text-sky-300', PLAN: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', SOLVE: 'bg-accent-soft text-accent', CHECK: 'bg-success-soft text-success', COMMUNICATE: 'bg-warn-soft text-warn' };
  return <span className="flex items-start gap-2"><span className={cx('mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider', color[m[1]])}>{m[1]}</span><span className="math">{m[2]}</span></span>;
}

function FlagModal({ open, onClose, questionId }: { open: boolean; onClose: () => void; questionId: string }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Report a problem">
      <p className="mb-3 text-sm text-muted">Spotted a mistake in this question or its solution? Our team reviews every report.</p>
      <Textarea label="What’s wrong?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The answer key seems wrong because…" maxLength={500} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={reason.trim().length < 3} onClick={async () => { setBusy(true); try { await post('/me/flag', { kind: 'question', ref: questionId, reason }); toast('Thanks! Your report was sent.', 'success'); setReason(''); onClose(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } }}>Send report</Button></div>
    </Modal>
  );
}
