import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ListChecks, Plus, Trash2, Wand2 } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { post, patch, del, get, errMsg } from '../lib/api.ts';
import { toast, confettiBurst } from '../lib/celebrate.ts';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Progress, cx } from '../components/ui.tsx';

interface A { id: string; title: string; due_date: string | null; topic: string | null; skill_id: string | null; skillTitle: string | null; tasks: { label: string; done: boolean }[]; done: number; daysLeft: number | null }
interface Org { schedule: { id: string; title: string; daysLeft: number; tasksLeft: number; minutesToday: number; priority: string }[]; totalMinutesToday: number; tip: string }

export default function Organizer() {
  const { data, reload, setData } = useFetch<{ assignments: A[] }>('/me/assignments');
  const [open, setOpen] = useState(false);
  const [org, setOrg] = useState<Org | null>(null);
  async function toggle(a: A, i: number) {
    try {
      const r = await patch<{ tasks: A['tasks']; done: boolean }>(`/me/assignments/${a.id}`, { task: i, taskDone: !a.tasks[i].done });
      setData({ assignments: data!.assignments.map((x) => (x.id === a.id ? { ...x, tasks: r.tasks, done: r.done ? 1 : 0 } : x)) });
      if (r.done && !a.done) { confettiBurst(); toast(`${a.title} complete!`, 'success'); }
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <div>
      <PageHeader icon={<ListChecks className="h-7 w-7 text-accent" />} title="Homework Organizer" subtitle="Break assignments into bite-sized tasks and let us suggest what to do first." actions={<><Button variant="secondary" icon={<Wand2 className="h-4 w-4" />} onClick={async () => setOrg(await get<Org>('/me/assignments/organize'))}>Organize my workload</Button><Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add assignment</Button></>} />
      {org && (
        <Card className="mb-6 p-5">
          <h2 className="font-bold">Suggested plan for today · ~{org.totalMinutesToday} min</h2>
          <ol className="mt-3 space-y-2">{org.schedule.map((s, i) => <li key={s.id} className="flex items-center gap-3 text-sm"><span className="bg-brand grid h-7 w-7 place-items-center rounded-lg text-xs font-bold text-white">{i + 1}</span><span className="flex-1 font-semibold">{s.title}</span><Badge tone={s.priority === 'High' ? 'danger' : s.priority === 'Medium' ? 'warn' : 'neutral'}>{s.priority}</Badge><span className="text-muted">{s.minutesToday} min</span></li>)}</ol>
          <p className="mt-3 text-sm text-muted">{org.tip}</p>
        </Card>
      )}
      {!data?.assignments.length ? <EmptyState icon="📒" title="No assignments" body="Add your math homework and we’ll break it into steps." action={<Button onClick={() => setOpen(true)}>Add assignment</Button>} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.assignments.map((a) => {
            const done = a.tasks.filter((t) => t.done).length;
            return (
              <Card key={a.id} className={cx('p-5', !!a.done && 'opacity-70')}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><h3 className="text-lg font-bold">{a.title}</h3><p className="text-sm text-muted">{a.due_date ? (a.daysLeft! < 0 ? `Was due ${a.due_date}` : a.daysLeft === 0 ? 'Due today' : a.daysLeft === 1 ? 'Due tomorrow' : `Due in ${a.daysLeft} days`) : 'No due date'}{a.topic ? ` · ${a.topic}` : ''}</p></div>
                  <button onClick={async () => { await del(`/me/assignments/${a.id}`); reload(); }} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label={`Delete ${a.title}`}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="my-3 flex items-center gap-2"><Progress value={(done / Math.max(1, a.tasks.length)) * 100} tone="success" /><span className="text-xs font-bold text-muted">{done}/{a.tasks.length}</span></div>
                <ul className="space-y-1">{a.tasks.map((t, i) => <li key={i}><button onClick={() => toggle(a, i)} className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm hover:bg-surface-2">{t.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" /> : <Circle className="h-5 w-5 shrink-0 text-muted" />}<span className={cx(t.done && 'text-muted line-through')}>{t.label}</span></button></li>)}</ul>
                {a.skill_id && <div className="mt-3 flex gap-2"><Link to={`/lesson/${a.skill_id}`}><Badge tone="accent">📚 {a.skillTitle} lesson</Badge></Link><Link to="/homework"><Badge tone="warn">📸 Homework helper</Badge></Link></div>}
              </Card>
            );
          })}
        </div>
      )}
      <AddModal open={open} onClose={() => setOpen(false)} onAdded={() => { setOpen(false); reload(); }} />
    </div>
  );
}

function AddModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState('Math Homework'); const [due, setDue] = useState(''); const [topic, setTopic] = useState(''); const [questions, setQuestions] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Add assignment">
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Input label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Quadratics" maxLength={80} />
        <Input label="Questions" value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder="e.g. 1-10 or 12" maxLength={40} hint="We’ll break these into chunks of 5, plus review and checking tasks." />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!title.trim()} onClick={async () => { setBusy(true); try { await post('/me/assignments', { title, dueDate: due || undefined, topic, questions }); toast('Assignment added', 'success'); onAdded(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } }}>Add & break it down</Button></div>
      </div>
    </Modal>
  );
}
