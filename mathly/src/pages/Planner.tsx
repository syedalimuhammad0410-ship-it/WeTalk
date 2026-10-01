import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, Sparkles } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { Badge, Button, Card, EmptyState, PageHeader, cx } from '../components/ui.tsx';

interface Ev { date: string; kind: string; title: string; link: string; done: boolean; minutes?: number }
const KIND: Record<string, string> = { test: 'bg-danger-soft text-danger', homework: 'bg-warn-soft text-warn', mock: 'bg-accent-soft text-accent', rest: 'bg-surface-2 text-muted', weak: 'bg-warn-soft text-warn' };

export default function Planner() {
  const { data, reload } = useFetch<{ events: Ev[]; dailyGoalMin: number; today: string; activity: { day: string; seconds: number }[] }>('/me/planner');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function add() {
    setBusy(true);
    try { const r = await post<{ message: string; link: string }>('/me/planner/parse', { text }); toast(r.message, 'success'); setText(''); reload(); if (r.link.startsWith('/test-prep')) nav(r.link); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: 28 }, (_, i) => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
  return (
    <div>
      <PageHeader icon={<CalendarDays className="h-7 w-7 text-accent" />} title="Smart Study Planner" subtitle="Type what’s coming up — we’ll build the plan and adjust it if you miss a day." />
      <Card className="mb-6 p-5">
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. “Math test October 15” or “Quadratics homework due Friday, questions 1-10”" aria-label="Add to planner" className="h-12 flex-1 rounded-2xl border-2 border-border bg-surface px-4 outline-none focus:border-accent" maxLength={300} />
          <Button type="submit" size="lg" loading={busy} disabled={text.trim().length < 4} icon={<Sparkles className="h-4 w-4" />}>Plan it</Button>
        </form>
        <p className="mt-2 text-xs text-muted">Daily goal: {data?.dailyGoalMin ?? 20} minutes. Tests become day-by-day plans with lessons, practice, weak-topic sessions, a mock test and rest days.</p>
      </Card>
      {!data?.events.length ? <EmptyState icon="🗓️" title="Nothing scheduled yet" body="Add a test or homework above, or create a test plan in Test Prep." action={<Link to="/test-prep"><Button variant="secondary">Go to Test Prep</Button></Link>} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((d) => {
            const ev = data.events.filter((e) => e.date === d);
            const isToday = d === today;
            return (
              <Card key={d} className={cx('min-h-28 p-3', isToday && 'ring-2 ring-accent', !ev.length && 'opacity-70')}>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{isToday ? 'Today' : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                <ul className="space-y-1.5">{ev.map((e, i) => <li key={i}><Link to={e.link} className={cx('block rounded-xl px-2.5 py-1.5 text-xs font-semibold', KIND[e.kind] ?? 'bg-success-soft text-success', e.done && 'line-through opacity-60')}>{e.title}{e.minutes ? <span className="opacity-70"> · {e.minutes}m</span> : null}</Link></li>)}</ul>
                {!ev.length && <p className="text-xs text-muted">Free · <Link to="/practice" className="text-accent">practice</Link></p>}
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-center text-sm text-muted"><Badge>Tip</Badge> Homework items live in the <Link to="/organizer" className="font-semibold text-accent">Homework Organizer</Link>.</p>
    </div>
  );
}
