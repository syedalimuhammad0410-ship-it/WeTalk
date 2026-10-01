import { Users, ShieldCheck } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { Badge, Card, EmptyState, PageHeader, PageSkeleton, Progress, Stat } from '../components/ui.tsx';

interface Report {
  id: string; name: string; avatar: string; color: string; schoolLabel: string; learningLevel: string; minutes: number; questions: number; accuracy: number | null; improvement: number | null;
  strongest: { name: string; icon: string; percent: number } | null; needsPractice: { name: string; icon: string; percent: number } | null; topics: { domain: string; name: string; icon: string; percent: number }[];
  lessonsDone: number; streak: number; xp: number; days: { day: string; seconds: number }[]; recentSkills: string[];
}

export default function Family() {
  const { data, loading } = useFetch<{ reports: Report[] }>('/family/report');
  if (loading && !data) return <PageSkeleton />;
  return (
    <div>
      <PageHeader icon={<Users className="h-7 w-7 text-accent" />} title="Parent / Teacher Dashboard" subtitle="Weekly learning reports for every learner on this account." />
      <Card className="mb-6 flex items-start gap-3 p-4 text-sm text-muted"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />Reports show learning time, practice and mastery. Private AI tutor conversations and homework photos are never included.</Card>
      {!data?.reports.length ? <EmptyState icon="👨‍👩‍👧" title="No learners yet" body="Add learner profiles to see their weekly reports here." /> : (
        <div className="space-y-6">
          {data.reports.map((r) => {
            const max = Math.max(60, ...r.days.map((d) => d.seconds));
            const h = Math.floor(r.minutes / 60), m = r.minutes % 60;
            return (
              <Card key={r.id} className="p-6">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl text-3xl" style={{ background: `${r.color}26` }}>{r.avatar}</span>
                  <div className="mr-auto"><h2 className="text-xl font-extrabold">{r.name}’s weekly report</h2><p className="text-sm text-muted">{r.schoolLabel} · learning level {r.learningLevel}</p></div>
                  <Badge tone="warn">🔥 {r.streak} day streak</Badge>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Learning time" value={`${h}h ${m}m`} icon="⏱️" />
                  <Stat label="Questions" value={r.questions} icon="✏️" sub={r.accuracy != null ? `${r.accuracy}% correct` : undefined} />
                  <Stat label="Lessons completed" value={r.lessonsDone} icon="📚" />
                  <Stat label="Improvement" value={r.improvement != null ? `${r.improvement > 0 ? '+' : ''}${r.improvement}%` : '—'} icon="📈" sub="accuracy vs last week" />
                </div>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-bold">Daily minutes</p>
                    <div className="mt-2 flex h-24 items-end gap-2">{r.days.length ? r.days.map((d) => <div key={d.day} className="flex flex-1 flex-col items-center gap-1"><div className="bg-brand w-full rounded-t-md" style={{ height: `${(d.seconds / max) * 80}px` }} /><span className="text-[10px] text-muted">{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>) : <p className="text-sm text-muted">No activity this week.</p>}</div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-2xl bg-success-soft p-3"><p className="text-xs font-bold uppercase tracking-wider text-success">Strongest</p><p className="font-bold">{r.strongest ? `${r.strongest.icon} ${r.strongest.name}` : '—'}</p></div>
                      <div className="rounded-2xl bg-warn-soft p-3"><p className="text-xs font-bold uppercase tracking-wider text-warn">Needs practice</p><p className="font-bold">{r.needsPractice ? `${r.needsPractice.icon} ${r.needsPractice.name}` : '—'}</p></div>
                    </div>
                    {r.recentSkills.length > 0 && <p className="mt-3 text-sm text-muted">Practiced this week: {r.recentSkills.join(', ')}</p>}
                  </div>
                  <div className="space-y-2.5">{r.topics.map((t) => <div key={t.domain}><div className="mb-0.5 flex justify-between text-sm"><span>{t.icon} {t.name}</span><span className="font-bold">{t.percent}%</span></div><Progress value={t.percent} tone={t.percent >= 75 ? 'success' : t.percent >= 50 ? 'accent' : 'warn'} label={t.name} /></div>)}</div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
