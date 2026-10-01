import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { CURRICULA, ONBOARDING, SCHOOL_LEVELS } from '../../shared/curriculum.ts';
import { useApp } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { Logo } from '../components/Logo.tsx';
import { Button, Chip, Input, Progress } from '../components/ui.tsx';

type Step = 'name' | 'level' | 'curriculum' | 'course' | 'purposes' | 'enjoys' | 'styles' | 'goals' | 'daily' | 'done';
const STEPS: Step[] = ['name', 'level', 'curriculum', 'course', 'purposes', 'enjoys', 'styles', 'goals', 'daily', 'done'];
const COURSE_SUGGESTIONS: Record<string, string[]> = { early: ['Kindergarten math', 'Grade 1 math', 'Grade 2 math'], mid: ['Grade 5 math', 'Grade 7 math', 'Pre-algebra'], high: ['Algebra 1', 'Geometry', 'Algebra 2', 'Precalculus', 'AP Calculus AB', 'IB Math AA SL'], uni: ['Calculus I', 'Calculus II', 'Linear Algebra', 'Statistics', 'Discrete Math'] };

export default function Onboarding() {
  const { profile, refreshProfiles } = useApp();
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [name, setName] = useState(profile?.name ?? '');
  const [level, setLevel] = useState<number | null>(profile?.schoolGrade ?? null);
  const [curriculum, setCurriculum] = useState('us');
  const [course, setCourse] = useState('');
  const [purposes, setPurposes] = useState<string[]>([]);
  const [enjoys, setEnjoys] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [daily, setDaily] = useState(20);
  const [busy, setBusy] = useState(false);
  const step = STEPS[i];
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const kid = level != null && level <= 2;

  async function finish(goPlacement: boolean) {
    setBusy(true);
    try {
      await post('/me/onboarding', { name, schoolGrade: level, curriculum, currentCourse: course, purposes, enjoys, styles, goals, dailyGoalMin: daily });
      await refreshProfiles();
      nav(goPlacement ? '/placement' : '/', { replace: true });
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  const next = () => setI((x) => Math.min(STEPS.length - 1, x + 1));
  const back = () => setI((x) => Math.max(0, x - 1));
  const sugg = level == null ? COURSE_SUGGESTIONS.mid : level <= 3 ? COURSE_SUGGESTIONS.early : level <= 8 ? COURSE_SUGGESTIONS.mid : level <= 12 ? COURSE_SUGGESTIONS.high : COURSE_SUGGESTIONS.uni;

  const multi = (title: string, sub: string, options: string[], value: string[], set: (v: string[]) => void) => (
    <Q title={title} sub={sub}><div className="flex flex-wrap gap-2.5">{options.map((o) => <Chip key={o} selected={value.includes(o)} onClick={() => toggle(value, set, o)}>{o}</Chip>)}</div></Q>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-4 px-5 py-5">
        <Logo size={30} showText={false} />
        <Progress value={(i / (STEPS.length - 1)) * 100} label="Onboarding progress" />
        <span className="shrink-0 text-sm font-semibold text-muted">{Math.min(i + 1, STEPS.length - 1)}/{STEPS.length - 1}</span>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-10">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.22 }} className="flex-1 pt-6 sm:pt-12">
            {step === 'name' && <Q title="What should we call you?" sub="A first name or nickname is perfect."><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={40} className="h-16 text-2xl font-bold" autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) next(); }} /></Q>}
            {step === 'level' && <Q title={`Nice to meet you, ${name || 'friend'}! What’s your school level?`} sub="We’ll still find your real learning level — you can learn above or below your grade."><div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">{SCHOOL_LEVELS.map((l) => <Chip key={l.value} selected={level === l.value} onClick={() => { setLevel(l.value); setTimeout(next, 180); }}>{l.label}</Chip>)}</div></Q>}
            {step === 'curriculum' && <Q title="Where do you study?" sub="We map lessons to your country’s grade names and curriculum."><div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{CURRICULA.map((c) => <Chip key={c.id} selected={curriculum === c.id} onClick={() => { setCurriculum(c.id); setTimeout(next, 180); }}><span className="mr-1.5">{c.flag}</span>{c.label}</Chip>)}</div></Q>}
            {step === 'course' && <Q title="What math course are you taking right now?" sub="Type anything — or skip."><Input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. Grade 8 Math, Algebra 1, Calculus I" aria-label="Current course" maxLength={80} /><div className="mt-3 flex flex-wrap gap-2">{sugg.map((s) => <Chip key={s} selected={course === s} onClick={() => setCourse(s)}>{s}</Chip>)}</div></Q>}
            {step === 'purposes' && multi('What do you want to use math for?', 'Pick as many as you like.', ONBOARDING.purposes, purposes, setPurposes)}
            {step === 'enjoys' && multi(kid ? 'What kind of math is fun for you?' : 'What kinds of math do you enjoy?', 'We’ll mix more of these in.', ONBOARDING.enjoys, enjoys, setEnjoys)}
            {step === 'styles' && multi('How do you like learning?', 'Your tutor and lessons adapt to this.', ONBOARDING.styles, styles, setStyles)}
            {step === 'goals' && multi('What are your goals?', 'You can change these any time.', ONBOARDING.goals, goals, setGoals)}
            {step === 'daily' && <Q title="Set a daily goal" sub="Small, steady practice beats cramming."><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[{ m: 10, l: 'Casual' }, { m: 20, l: 'Regular' }, { m: 30, l: 'Serious' }, { m: 45, l: 'Intense' }].map((o) => <button key={o.m} onClick={() => setDaily(o.m)} aria-pressed={daily === o.m} className={`card p-5 text-center transition ${daily === o.m ? 'ring-2 ring-accent' : 'hover:border-accent/50'}`}><div className="text-3xl font-extrabold">{o.m}</div><div className="text-sm text-muted">min / day · {o.l}</div></button>)}</div></Q>}
            {step === 'done' && (
              <div className="text-center">
                <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} className="text-7xl">🧭</motion.div>
                <h1 className="mt-6 text-3xl font-extrabold">Let’s find your starting point</h1>
                <p className="mx-auto mt-3 max-w-lg text-muted">A quick adaptive check (about 10 minutes) finds your real learning level in each area of math — so lessons are never too easy or too hard. Questions get harder or easier as you go. It’s not a test you can fail.</p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Button size="lg" loading={busy} onClick={() => finish(true)}>Start placement check</Button><Button size="lg" variant="secondary" disabled={busy} onClick={() => finish(false)}>Skip for now</Button></div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        {step !== 'done' && (
          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" onClick={back} disabled={i === 0} icon={<ArrowLeft className="h-4 w-4" />}>Back</Button>
            <div className="flex gap-2">
              {step !== 'name' && <Button variant="ghost" onClick={next}>Skip</Button>}
              <Button onClick={next} disabled={step === 'name' && !name.trim()}>Continue<ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Q({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <div><h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{title}</h1>{sub && <p className="mt-2 text-muted">{sub}</p>}<div className="mt-8">{children}</div></div>;
}
