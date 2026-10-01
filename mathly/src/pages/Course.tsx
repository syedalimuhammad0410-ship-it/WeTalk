import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Circle, Lock, PlayCircle, RotateCcw, Flag, Trash2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useFetch, useApp } from '../lib/store.tsx';
import { post, del, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { Badge, Button, Card, ErrorState, PageSkeleton, Progress, Ring, cx } from '../components/ui.tsx';

interface Lesson { id: string; title: string; skillId?: string; kind: string; generated: boolean; done: boolean; locked: boolean; mastery: number | null; gradeLabel: string | null; objective?: string }
interface CourseData {
  course: { id: string; title: string; description: string; icon: string; band?: string; difficulty: string; generatedBy: string; status?: string; percent: number; completed: number; lessons: number; units: { id: string; title: string; description?: string; lessons: Lesson[] }[]; prerequisites: { id: string; title: string; mastery: number }[]; validation?: { checked: number; passed: number; rejected: string[] } | null; notes?: string | null };
  enrolled: boolean; nextLesson: string | null;
}

export default function CoursePage() {
  const { courseId } = useParams();
  const { data, error, loading, reload } = useFetch<CourseData>(`/me/courses/${courseId}`);
  const { profile } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Course not found.'} onRetry={reload} />;
  const c = data.course;
  const lessonLink = (l: Lesson) => (l.generated ? `/learn/${c.id}/lesson/${l.id}` : `/lesson/${l.skillId ?? l.id}?course=${c.id}`);
  const next = c.units.flatMap((u) => u.lessons).find((l) => l.id === data.nextLesson);
  const personal = c.generatedBy !== 'curriculum';
  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div className="bg-brand absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-15 blur-2xl" />
        <div className="relative flex flex-wrap items-start gap-5">
          <span className="bg-brand grid h-16 w-16 place-items-center rounded-3xl text-3xl font-bold text-white">{c.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">{c.band && <Badge>{c.band}</Badge>}<Badge tone="accent">{c.difficulty}</Badge>{c.generatedBy === 'ai' && <Badge tone="warn">AI-built · content verified</Badge>}{c.generatedBy === 'planner' && <Badge tone="accent">Personalized path</Badge>}{c.status === 'approved' && personal && <Badge tone="success"><ShieldCheck className="h-3 w-3" />Reviewed</Badge>}</div>
            <h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">{c.title}</h1>
            <p className="mt-1 max-w-2xl text-muted">{c.description}</p>
            {c.notes && <p className="mt-2 max-w-2xl text-sm text-muted">💡 {c.notes}</p>}
          </div>
          <Ring value={c.percent} size={84} stroke={8}><span className="text-lg font-extrabold">{c.percent}%</span></Ring>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2">
          {next && <Button onClick={() => nav(lessonLink(next))} icon={<PlayCircle className="h-5 w-5" />}>{c.completed ? 'Continue' : 'Start'}: {next.title}</Button>}
          {!data.enrolled ? <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); try { await post(`/me/courses/${c.id}/enroll`); toast('Added to your courses', 'success'); reload(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } }}>Enroll</Button>
            : <Button variant="ghost" onClick={async () => { await del(`/me/courses/${c.id}/enroll`); reload(); }}>Leave course</Button>}
          {personal && c.status !== 'approved' && <Button variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => { if (!confirm('Delete this custom course?')) return; try { await del(`/me/courses/${c.id}`); nav('/learn'); } catch (e) { toast(errMsg(e), 'error'); } }}>Delete</Button>}
        </div>
      </Card>

      {c.prerequisites.length > 0 && (
        <Card className="p-5">
          <h2 className="font-bold">Before you start</h2>
          <p className="text-sm text-muted">We added a short review of these foundations{profile ? ` for ${profile.name}` : ''}. You can jump straight in if you feel ready.</p>
          <div className="mt-3 flex flex-wrap gap-2">{c.prerequisites.map((p) => <Link key={p.id} to={`/lesson/${p.id}`} className="rounded-xl bg-surface-2 px-3 py-1.5 text-sm font-semibold hover:text-accent">{p.title} <span className="text-muted">· {p.mastery}%</span></Link>)}</div>
        </Card>
      )}

      <div className="space-y-4">
        {c.units.map((u, ui) => {
          const done = u.lessons.filter((l) => l.done).length;
          return (
            <Card key={u.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-xs font-bold uppercase tracking-wider text-muted">{u.id === 'prereq-review' ? 'Review' : u.id === 'checkpoint' ? 'Assessment' : `Unit ${ui + 1 - (c.units[0]?.id === 'prereq-review' ? 1 : 0)}`}</p><h2 className="text-lg font-bold">{u.title}</h2>{u.description && <p className="text-sm text-muted">{u.description}</p>}</div>
                <div className="flex w-40 items-center gap-2"><Progress value={(done / u.lessons.length) * 100} /><span className="text-xs font-bold text-muted">{done}/{u.lessons.length}</span></div>
              </div>
              <ul className="divide-y divide-border">
                {u.lessons.map((l) => (
                  <li key={l.id}>
                    <Link to={lessonLink(l)} className={cx('flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-surface-2', l.locked && 'opacity-70')}>
                      {l.done ? <CheckCircle2 className="h-6 w-6 shrink-0 text-success" /> : l.locked ? <Lock className="h-5 w-5 shrink-0 text-muted" /> : l.kind === 'review' ? <RotateCcw className="h-5 w-5 shrink-0 text-warn" /> : l.kind === 'checkpoint' ? <Flag className="h-5 w-5 shrink-0 text-accent" /> : <Circle className="h-5 w-5 shrink-0 text-muted" />}
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{l.title}</span><span className="block truncate text-xs text-muted">{l.objective}{l.gradeLabel ? ` · ${l.gradeLabel}` : ''}{l.locked ? ' · finish prerequisites first (or try anyway)' : ''}</span></span>
                      {l.generated && <Badge tone="warn">New lesson</Badge>}
                      {l.mastery != null && l.mastery > 0 && <span className="text-xs font-bold text-muted">{l.mastery}%</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {c.validation && <p className="text-center text-xs text-muted">AI content check: {c.validation.passed}/{c.validation.checked} generated practice questions passed automatic mathematical verification; the rest were removed.</p>}
    </div>
  );
}
