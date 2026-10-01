import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Circle, RefreshCw, Trash2, Archive, Info } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { post, patch, del, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { Badge, Button, Card, ErrorState, PageSkeleton, Progress, Ring, cx } from '../components/ui.tsx';

interface Item { kind: string; skillId?: string; label: string; minutes: number; done?: boolean }
interface Day { date: string; type: string; title: string; items: Item[]; done: boolean; moved?: boolean }
interface Data {
  test: { id: string; title: string; testDate: string; daysLeft: number; details: { calculator?: boolean; format?: string; about?: string }; skills: { id: string; title: string }[]; plan: Day[]; moved: number; archived: boolean };
  readiness: { overall: number; topics: { skillId: string; title: string; percent: number; mastery: number; mock: number | null; needsWork: boolean }[]; note: string };
  mocks: { id: string; score: number; completed_at: string }[]; today: string;
}
const TYPE_ICON: Record<string, string> = { concepts: '📚', practice: '✏️', weak: '🎯', mixed: '🔀', mock: '📝', warmup: '🔥', rest: '😴' };

export default function TestPlan() {
  const { id } = useParams();
  const { data, error, loading, reload, setData } = useFetch<Data>(`/me/tests/${id}`);
  const nav = useNavigate();
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Test plan not found.'} onRetry={reload} />;
  const t = data.test; const r = data.readiness;
  const itemLink = (it: Item) => it.kind === 'mock' ? `/mock-test?plan=${t.id}` : it.kind === 'lesson' ? `/lesson/${it.skillId}` : it.skillId ? `/practice/session?skill=${it.skillId}&mode=${it.kind === 'targeted' ? 'targeted' : it.kind === 'review' ? 'review' : 'practice'}` : '/practice';
  async function toggle(di: number, ii: number, done: boolean) {
    try { const res = await post<{ plan: Day[] }>(`/me/tests/${t.id}/items`, { day: di, item: ii, done }); setData({ ...data!, test: { ...t, plan: res.plan } }); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-6 p-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-accent">Test prep</p>
          <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{t.title}</h1>
          <p className="mt-1 text-muted">{t.daysLeft > 0 ? `${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'} to go` : t.daysLeft === 0 ? 'Test day — you’ve got this!' : 'This test date has passed'} · {t.testDate} · {t.details.calculator ? 'Calculator allowed' : 'No calculator'} · {t.details.format ?? 'Mixed'}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => nav(`/mock-test?plan=${t.id}`)}>Take a mock test</Button>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={async () => { try { await post(`/me/tests/${t.id}/regenerate`); toast('Plan rebuilt from your latest mastery', 'success'); reload(); } catch (e) { toast(errMsg(e), 'error'); } }}>Rebuild plan</Button>
            <Button variant="ghost" icon={<Archive className="h-4 w-4" />} onClick={async () => { await patch(`/me/tests/${t.id}`, { archived: !t.archived }); reload(); }}>{t.archived ? 'Unarchive' : 'Archive'}</Button>
            <Button variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => { if (confirm('Delete this test plan?')) { await del(`/me/tests/${t.id}`); nav('/test-prep'); } }}>Delete</Button>
          </div>
        </div>
        <div className="text-center"><Ring value={r.overall} size={120} stroke={10} color={r.overall >= 75 ? 'var(--success)' : r.overall >= 50 ? 'var(--accent)' : 'var(--warn)'}><div><div className="text-3xl font-extrabold">{r.overall}%</div><div className="text-[10px] font-bold uppercase tracking-wider text-muted">Readiness</div></div></Ring></div>
      </Card>
      {t.moved > 0 && <Card className="flex items-center gap-2 p-4 text-sm"><Info className="h-4 w-4 text-accent" />We moved {t.moved} unfinished session{t.moved > 1 ? 's' : ''} from missed days onto upcoming days. No stress — your plan adapts.</Card>}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Your study plan</h2>
          {t.plan.map((d, di) => {
            const isToday = d.date === data.today; const past = d.date < data.today;
            return (
              <Card key={d.date} className={cx('p-4', isToday && 'ring-2 ring-accent', past && 'opacity-70')}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xl">{TYPE_ICON[d.type] ?? '📘'}</span>
                  <span className="font-bold">{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                  {isToday && <Badge tone="accent">Today</Badge>}{d.done && <Badge tone="success">Done</Badge>}{d.moved && <Badge>Moved</Badge>}
                  <span className="ml-auto text-sm text-muted">{d.title}</span>
                </div>
                <ul className="space-y-1.5">{d.items.map((it, ii) => (
                  <li key={ii} className="flex items-center gap-3">
                    {it.kind === 'rest' ? <span className="h-5 w-5" /> : <button onClick={() => toggle(di, ii, !it.done)} aria-label={it.done ? `Mark ${it.label} not done` : `Mark ${it.label} done`}>{it.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-muted" />}</button>}
                    {it.kind === 'rest' ? <span className="text-sm text-muted">{it.label}</span> : <Link to={itemLink(it)} className={cx('flex-1 text-sm font-semibold hover:text-accent', it.done && 'text-muted line-through')}>{it.label}</Link>}
                    {it.minutes > 0 && <span className="text-xs text-muted">{it.minutes} min</span>}
                  </li>
                ))}</ul>
              </Card>
            );
          })}
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-bold">Readiness by topic</h2>
            <div className="mt-3 space-y-3">{r.topics.map((x) => <div key={x.skillId}><div className="mb-1 flex justify-between text-sm"><Link to={`/lesson/${x.skillId}`} className="font-semibold hover:text-accent">{x.title}</Link><span className="font-bold">{x.percent}%</span></div><Progress value={x.percent} tone={x.percent >= 75 ? 'success' : x.percent >= 50 ? 'accent' : 'warn'} label={x.title} />{x.needsWork && <p className="mt-1 text-xs text-warn">Needs more practice</p>}</div>)}</div>
            <p className="mt-4 text-xs text-muted">{r.note}</p>
          </Card>
          {data.mocks.length > 0 && <Card className="p-5"><h2 className="font-bold">Mock tests</h2><ul className="mt-2 space-y-1 text-sm">{data.mocks.map((m) => <li key={m.id} className="flex justify-between"><span>{new Date(m.completed_at.replace(' ', 'T') + 'Z').toLocaleDateString()}</span><strong>{Math.round(m.score)}%</strong></li>)}</ul></Card>}
        </aside>
      </div>
    </div>
  );
}
