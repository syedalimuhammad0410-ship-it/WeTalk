import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { Badge, Card, ErrorState, PageHeader, PageSkeleton, Progress as Bar, Ring, Stat, cx } from '../components/ui.tsx';

interface P {
  xp: number; level: { level: number; current: number; base: number; next: number };
  unlocks: { level: number; kind: string; id: string; label: string; unlocked: boolean }[];
  achievements: { id: string; title: string; description: string; icon: string; xp: number; unlocked: boolean; unlockedAt: string | null }[];
  streak: { current: number; best: number; freezes: number; todayDone: boolean };
  learningLevel: { overall: number | null; label: string; domains: { domain: string; name: string; icon: string; level: number; label: string }[] };
  topics: { domain: string; name: string; icon: string; percent: number }[];
  xpDays: { day: string; xp: number }[]; heat: { day: string; seconds: number; questions: number }[];
  totals: { questions: number; correct: number; lessons: number; accuracy: number | null };
  recentXp: { amount: number; reason: string; created_at: string }[];
}

export default function ProgressPage() {
  const { data, error, loading, reload } = useFetch<P>('/me/progress');
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load progress.'} onRetry={reload} />;
  const lv = data.level; const pct = ((lv.current - lv.base) / Math.max(1, lv.next - lv.base)) * 100;
  const heatMap = Object.fromEntries(data.heat.map((h) => [h.day, h.seconds]));
  const days = Array.from({ length: 84 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (83 - i)); return d.toISOString().slice(0, 10); });
  const maxXp = Math.max(1, ...data.xpDays.map((x) => x.xp));
  return (
    <div className="space-y-6">
      <PageHeader title="Progress & Achievements" subtitle="XP measures how much you engage. Mastery measures what you’ve learned." />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="flex flex-col items-center p-6 text-center">
          <Ring value={pct} size={140} stroke={12}><div><div className="text-xs font-bold uppercase tracking-wider text-muted">Level</div><div className="text-5xl font-extrabold">{lv.level}</div></div></Ring>
          <p className="mt-3 text-2xl font-extrabold">{data.xp.toLocaleString()} XP</p>
          <p className="text-sm text-muted">{(lv.next - lv.current).toLocaleString()} XP to level {lv.level + 1}</p>
          <div className="mt-4 w-full"><Bar value={pct} /></div>
        </Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat icon="🔥" label="Streak" value={`${data.streak.current} days`} sub={`Best ${data.streak.best}${data.streak.freezes ? ` · ${data.streak.freezes} 🧊` : ''}`} />
          <Stat icon="🎓" label="Learning level" value={data.learningLevel.overall != null ? data.learningLevel.label : '—'} />
          <Stat icon="✅" label="Questions" value={data.totals.questions.toLocaleString()} sub={data.totals.accuracy != null ? `${data.totals.accuracy}% accuracy` : undefined} />
          <Stat icon="📚" label="Lessons" value={data.totals.lessons} />
          <Card className="col-span-2 p-4 md:col-span-4">
            <p className="mb-2 text-sm font-bold">XP — last 30 days</p>
            <div className="flex h-24 items-end gap-1" role="img" aria-label="XP per day chart">
              {data.xpDays.length ? data.xpDays.map((x) => <div key={x.day} className="flex-1" title={`${x.day}: ${x.xp} XP`}><motion.div initial={{ height: 0 }} animate={{ height: `${(x.xp / maxXp) * 100}%` }} className="bg-brand min-h-1 rounded-t-md" /></div>) : <p className="text-sm text-muted">Earn XP by practicing — your chart will appear here.</p>}
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-5">
        <p className="mb-3 text-sm font-bold">Learning activity (12 weeks)</p>
        <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto" role="img" aria-label="Activity heatmap">
          {days.map((d) => { const s = heatMap[d] ?? 0; const lvl = s === 0 ? 0 : s < 300 ? 1 : s < 900 ? 2 : s < 1800 ? 3 : 4; return <div key={d} title={`${d}: ${Math.round(s / 60)} min`} className="h-3.5 w-3.5 rounded-[4px]" style={{ background: lvl ? `color-mix(in oklab, var(--accent) ${lvl * 25}%, var(--surface-2))` : 'var(--surface-2)' }} />; })}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-bold">Mastery by topic</h2>
          <div className="mt-4 space-y-3">{data.topics.length ? data.topics.map((t) => <div key={t.domain}><div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{t.icon} {t.name}</span><span className="font-bold">{t.percent}%</span></div><Bar value={t.percent} tone={t.percent >= 75 ? 'success' : t.percent >= 50 ? 'accent' : 'warn'} label={t.name} /></div>) : <p className="text-sm text-muted">Practice a few skills to see mastery here.</p>}</div>
        </Card>
        <Card className="p-5">
          <h2 className="font-bold">Learning level by area</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">{data.learningLevel.domains.map((d) => <div key={d.domain} className="rounded-2xl bg-surface-2 p-3"><div className="text-xs text-muted">{d.icon} {d.name}</div><div className="font-bold">{d.label}</div></div>)}</div>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">Achievements · {data.achievements.filter((a) => a.unlocked).length}/{data.achievements.length}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.achievements.map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.02 }} className={cx('card p-4 text-center', !a.unlocked && 'opacity-55 grayscale')}>
              <div className={cx('mx-auto grid h-14 w-14 place-items-center rounded-2xl text-3xl', a.unlocked ? 'bg-accent-soft' : 'bg-surface-2')}>{a.unlocked ? a.icon : <Lock className="h-6 w-6 text-muted" />}</div>
              <p className="mt-2 font-bold leading-tight">{a.title}</p><p className="mt-1 text-xs text-muted">{a.description}</p>
              <Badge tone={a.unlocked ? 'success' : 'neutral'} className="mt-2">{a.unlocked ? `Unlocked · +${a.xp} XP` : `+${a.xp} XP`}</Badge>
            </motion.div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5"><h2 className="font-bold">Unlocks</h2><ul className="mt-3 space-y-2">{data.unlocks.map((u) => <li key={u.id} className={cx('flex items-center justify-between rounded-xl p-2 text-sm', u.unlocked ? 'bg-success-soft' : 'bg-surface-2 text-muted')}><span className="font-semibold">{u.unlocked ? '🔓' : '🔒'} {u.label}</span><span>Level {u.level}</span></li>)}</ul></Card>
        <Card className="p-5"><h2 className="font-bold">Recent XP</h2><ul className="mt-3 space-y-1.5 text-sm">{data.recentXp.length ? data.recentXp.map((x, i) => <li key={i} className="flex justify-between"><span className="truncate">{x.reason}</span><span className="font-bold text-success">+{x.amount}</span></li>) : <li className="text-muted">No XP yet — start a lesson!</li>}</ul></Card>
      </div>
    </div>
  );
}
