import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Brain, CalendarClock, ClipboardCheck, Compass, MessageCircle, RotateCcw, Sparkles, Sun, Target, Wand2 } from 'lucide-react';
import { DOMAINS } from '../../shared/curriculum.ts';
import type { DomainId, ProfileSummary } from '../../shared/types.ts';
import { useApp, useFetch } from '../lib/store.tsx';
import { emit, type Achievement } from '../lib/celebrate.ts';
import { openTutor } from '../lib/tutorBus.ts';
import { Badge, Button, Card, ErrorState, PageSkeleton, Progress, Ring } from '../components/ui.tsx';

interface Rec { skillId: string; title: string; domain: DomainId; kind: string; reason: string; minutes: number; mastery: number }
interface Dash {
  profile: ProfileSummary; learningLevelLabel: string; schoolLabel: string; xp: number; level: { level: number; current: number; base: number; next: number };
  streak: { current: number; best: number; todayDone: boolean; freezes: number; todayMinutes: number }; dailyGoalMin: number; todayMinutes: number;
  recommendations: Rec[]; continueLearning: { lessonKey: string; title: string; stage: string; progress: number; mastery: number | null; link: string } | null;
  dailyChallenge: { solved: boolean }; upcomingTests: { id: string; title: string; test_date: string }[]; assignments: { id: string; title: string; due_date: string | null }[];
  newAchievements: Achievement[]; unreadNotifications: number; aiAvailable: boolean; reviewDue: number;
}
const KIND_ICON: Record<string, string> = { review: '🔁', targeted: '🎯', course: '📚', next: '🧠', challenge: '⚡' };

function greeting() { const h = new Date().getHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

export default function Dashboard() {
  const { data, error, loading, reload } = useFetch<Dash>('/me/dashboard');
  const { profile } = useApp();
  const nav = useNavigate();
  useEffect(() => { for (const a of data?.newAchievements ?? []) emit({ type: 'achievement', achievement: a }); }, [data?.newAchievements]);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load your dashboard.'} onRetry={reload} />;
  const lv = data.level; const lvPct = ((lv.current - lv.base) / Math.max(1, lv.next - lv.base)) * 100;
  const goalPct = Math.min(100, (data.todayMinutes / data.dailyGoalMin) * 100);
  const early = profile?.ageBand === 'early'; const uni = profile?.ageBand === 'university';

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">{greeting()}, {data.profile.name} {uni ? '' : '👋'}</h1>
          <p className="mt-1 text-muted">{data.profile.learningLevel != null ? <>You’re currently working at approximately <strong className="text-text">{data.learningLevelLabel}</strong> mathematics.</> : <>Take the placement check to discover your learning level.</>}</p>
        </div>
        {!data.profile.placementDone && <Button icon={<Compass className="h-5 w-5" />} onClick={() => nav('/placement')}>Find my level</Button>}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="flex items-center gap-3 p-4"><span className="flame text-3xl" aria-hidden>🔥</span><div><div className="text-2xl font-extrabold">{data.streak.current} day{data.streak.current === 1 ? '' : 's'}</div><div className="text-xs text-muted">Streak{data.streak.freezes ? ` · ${data.streak.freezes} freeze${data.streak.freezes > 1 ? 's' : ''} 🧊` : ''}</div></div></Card>
        <Card className="p-4"><div className="flex items-center justify-between"><div><div className="text-2xl font-extrabold">Lv {lv.level}</div><div className="text-xs text-muted">{data.xp.toLocaleString()} XP</div></div><Ring value={lvPct} size={48} stroke={6}><span className="text-[10px] font-bold">{Math.round(lvPct)}%</span></Ring></div><p className="mt-2 text-xs text-muted">{(lv.next - lv.current).toLocaleString()} XP to level {lv.level + 1}</p></Card>
        <Card className="p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Learning level</div><div className="mt-1 text-xl font-extrabold">{data.profile.learningLevel != null ? data.learningLevelLabel : '—'}</div><div className="text-xs text-muted">School: {data.schoolLabel}</div></Card>
        <Card className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs font-semibold uppercase tracking-wide text-muted">Today’s goal</div><div className="mt-1 text-xl font-extrabold">{data.todayMinutes}/{data.dailyGoalMin} min</div></div><Ring value={goalPct} size={48} stroke={6} color="var(--success)"><span className="text-xs">{goalPct >= 100 ? '✓' : '⏱'}</span></Ring></div></Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {data.continueLearning && (
            <Card className="relative overflow-hidden p-6">
              <div className="bg-brand absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-15 blur-2xl" />
              <p className="text-xs font-bold uppercase tracking-widest text-accent">Continue learning</p>
              <h2 className="mt-2 text-2xl font-extrabold">{data.continueLearning.title}</h2>
              <div className="mt-4 flex items-center gap-3"><Progress value={data.continueLearning.progress} /><span className="text-sm font-bold">{data.continueLearning.progress}%</span></div>
              <Button className="mt-5" onClick={() => nav(data.continueLearning!.link)}>Continue<ArrowRight className="h-4 w-4" /></Button>
            </Card>
          )}
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">Today’s recommendations</h2><Link to="/skills" className="text-sm font-semibold text-accent">Skill tree</Link></div>
            <div className="space-y-2.5">
              {data.recommendations.map((r, i) => (
                <motion.div key={r.skillId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <Link to={r.kind === 'review' || r.kind === 'targeted' ? `/practice/session?skill=${r.skillId}&mode=${r.kind === 'review' ? 'review' : 'targeted'}` : `/lesson/${r.skillId}`} className="group flex items-center gap-4 rounded-2xl border border-border p-3.5 transition hover:border-accent/50 hover:bg-surface-2">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `${DOMAINS[r.domain].color}1f` }}>{KIND_ICON[r.kind] ?? DOMAINS[r.domain].icon}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-bold">{r.title}</span><span className="block truncate text-sm text-muted">{r.reason}</span></span>
                    <span className="shrink-0 text-right"><Badge>{r.minutes} min</Badge>{r.mastery > 0 && <span className="mt-1 block text-xs text-muted">{r.mastery}% mastery</span>}</span>
                  </Link>
                </motion.div>
              ))}
              <Link to="/daily" className="flex items-center gap-4 rounded-2xl border border-border p-3.5 transition hover:border-accent/50 hover:bg-surface-2">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-warn-soft text-2xl">🌅</span>
                <span className="flex-1"><span className="block font-bold">Daily Challenge</span><span className="block text-sm text-muted">{data.dailyChallenge.solved ? 'Solved today — nice!' : 'Can you solve it without a calculator? +100 XP'}</span></span>
                <Badge tone={data.dailyChallenge.solved ? 'success' : 'warn'}>{data.dailyChallenge.solved ? 'Done' : '5 min'}</Badge>
              </Link>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-3"><div className="bg-brand grid h-11 w-11 place-items-center rounded-2xl text-white"><Brain className="h-6 w-6" /></div><div><h2 className="font-bold">Ask your tutor</h2><p className="text-sm text-muted">{data.aiAvailable ? 'AI tutor that knows your level' : 'Hints, examples and quizzes'}</p></div></div>
            <button onClick={() => openTutor({})} className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-left text-muted hover:border-accent/50"><MessageCircle className="h-5 w-5" />What are you stuck on?</button>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            {[
              { to: '/homework', icon: '📸', t: 'Homework', d: 'Snap & learn' }, { to: '/practice', icon: <Target className="h-6 w-6" />, t: 'Practice', d: 'Adaptive modes' },
              ...(early ? [] : [{ to: '/learn-anything', icon: <Wand2 className="h-6 w-6" />, t: 'Learn Anything', d: 'Build a path' }, { to: '/test-prep', icon: <ClipboardCheck className="h-6 w-6" />, t: 'Test Prep', d: 'Plans & mocks' }]),
            ].map((q) => <Link key={q.to} to={q.to} className="card flex flex-col gap-2 p-4 transition hover:-translate-y-0.5"><span className="text-2xl text-accent">{q.icon}</span><span className="font-bold">{q.t}</span><span className="text-xs text-muted">{q.d}</span></Link>)}
          </div>
          {data.reviewDue > 0 && <Card className="flex items-center gap-3 p-4"><RotateCcw className="h-6 w-6 text-accent" /><div className="flex-1"><p className="font-bold">{data.reviewDue} skill{data.reviewDue > 1 ? 's' : ''} ready for review</p><p className="text-sm text-muted">A quick refresh keeps them strong.</p></div><Button size="sm" variant="soft" onClick={() => nav('/practice/session?mode=review')}>Review</Button></Card>}
          {(data.upcomingTests.length > 0 || data.assignments.length > 0) && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-bold"><CalendarClock className="h-5 w-5 text-accent" />Coming up</h2>
              <ul className="space-y-2 text-sm">
                {data.upcomingTests.map((t) => <li key={t.id}><Link to={`/test-prep/${t.id}`} className="flex justify-between gap-2 rounded-xl p-2 hover:bg-surface-2"><span className="font-semibold">📝 {t.title}</span><span className="text-muted">{t.test_date}</span></Link></li>)}
                {data.assignments.map((a) => <li key={a.id}><Link to="/organizer" className="flex justify-between gap-2 rounded-xl p-2 hover:bg-surface-2"><span className="font-semibold">📒 {a.title}</span><span className="text-muted">{a.due_date ?? 'No due date'}</span></Link></li>)}
              </ul>
            </Card>
          )}
          <Card className="flex items-center gap-3 p-4"><Sun className="h-6 w-6 text-warn" /><p className="text-sm text-muted"><Sparkles className="mr-1 inline h-4 w-4 text-accent" />Don’t just get the answer — learn how to think: <strong className="text-text">Understand → Plan → Solve → Check → Communicate.</strong></p></Card>
        </div>
      </div>
    </div>
  );
}
