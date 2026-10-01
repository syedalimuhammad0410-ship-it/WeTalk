import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ClipboardCheck } from 'lucide-react';
import { SKILLS } from '../../shared/skills.ts';
import { DOMAINS } from '../../shared/curriculum.ts';
import { useApp, useFetch } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { Badge, Button, Card, Chip, EmptyState, Input, Modal, PageHeader, Ring, Textarea, Toggle, cx } from '../components/ui.tsx';

interface TestRow { id: string; title: string; testDate: string; daysLeft: number; archived: boolean; skills: string[]; readiness: number }
const CONF = [{ v: 0, e: '😰', l: 'Not confident' }, { v: 1, e: '😐', l: 'Okay' }, { v: 2, e: '🙂', l: 'Comfortable' }, { v: 3, e: '😎', l: 'Very confident' }];

export default function TestPrep() {
  const { data, reload } = useFetch<{ tests: TestRow[] }>('/me/tests');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const active = data?.tests.filter((t) => !t.archived && t.daysLeft >= 0) ?? [];
  const past = data?.tests.filter((t) => t.archived || t.daysLeft < 0) ?? [];
  return (
    <div>
      <PageHeader icon={<ClipboardCheck className="h-7 w-7 text-accent" />} title="Test Prep" subtitle="Tell us about your test — we’ll build a day-by-day plan, track your readiness and give you mock tests." actions={<><Button variant="secondary" onClick={() => nav('/mock-test')}>Quick mock test</Button><Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New test plan</Button></>} />
      {active.length ? (
        <div className="grid gap-4 sm:grid-cols-2">{active.map((t) => (
          <Link key={t.id} to={`/test-prep/${t.id}`} className="card flex items-center gap-4 p-5 transition hover:-translate-y-0.5">
            <Ring value={t.readiness} size={72} stroke={7} color={t.readiness >= 75 ? 'var(--success)' : t.readiness >= 50 ? 'var(--accent)' : 'var(--warn)'}><span className="text-sm font-extrabold">{t.readiness}%</span></Ring>
            <div className="min-w-0 flex-1"><p className="truncate text-lg font-bold">{t.title}</p><p className="text-sm text-muted">{t.daysLeft === 0 ? 'Today!' : `In ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}`} · {t.testDate}</p><p className="mt-1 truncate text-xs text-muted">{t.skills.join(' · ')}</p></div>
          </Link>
        ))}</div>
      ) : <EmptyState icon="📝" title="No upcoming tests" body="Add a test to get a personalized study plan with daily lessons, practice, a mock test and a warm-up on test day." action={<Button onClick={() => setOpen(true)}>Plan for a test</Button>} />}
      {past.length > 0 && <section className="mt-8"><h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Past & archived</h2><div className="space-y-2">{past.map((t) => <Link key={t.id} to={`/test-prep/${t.id}`} className="card flex items-center justify-between p-4"><span className="font-semibold">{t.title}</span><span className="text-sm text-muted">{t.testDate}</span></Link>)}</div></section>}
      <NewTestModal open={open} onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); reload(); nav(`/test-prep/${id}`); }} />
    </div>
  );
}

function NewTestModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { profile } = useApp();
  const [title, setTitle] = useState(''); const [about, setAbout] = useState('');
  const [date, setDate] = useState(() => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
  const [skills, setSkills] = useState<string[]>([]); const [conf, setConf] = useState<Record<string, number>>({});
  const [calc, setCalc] = useState(true); const [format, setFormat] = useState('Mixed'); const [understanding, setUnderstanding] = useState('');
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [step, setStep] = useState(0);
  const level = profile?.learningLevel ?? profile?.schoolGrade ?? 7;
  const options = useMemo(() => SKILLS.filter((s) => (q ? `${s.title} ${s.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()) : Math.abs(s.grade - level) <= 1.5)).slice(0, 40), [q, level]);
  async function create() {
    setBusy(true);
    try { const r = await post<{ id: string }>('/me/tests', { title, testDate: date, skills, topicsText: about, confidence: conf, calculator: calc, format, about, understanding }); toast('Study plan created!', 'success'); onCreated(r.id); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Plan for a test" wide>
      {step === 0 && (
        <div className="space-y-4">
          <Input label="What is the test?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Grade 8 Algebra unit test" maxLength={120} />
          <Input label="Test date" type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          <Textarea label="What is the test about? (optional)" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="e.g. Linear equations, graphing and word problems" />
          <div className="flex justify-end"><Button disabled={!title.trim() || !date} onClick={() => setStep(1)}>Next: topics</Button></div>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-2xl border border-border px-3"><Search className="h-4 w-4 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…" aria-label="Search topics" className="h-11 flex-1 bg-transparent outline-none" /></div>
          <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">{options.map((s) => <Chip key={s.id} selected={skills.includes(s.id)} onClick={() => setSkills((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}>{DOMAINS[s.domain].icon} {s.title}</Chip>)}</div>
          <p className="text-xs text-muted">{skills.length ? `${skills.length} selected` : 'Pick the topics on your test — or skip and we’ll infer them from the description.'}</p>
          <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(0)}>Back</Button><Button disabled={!skills.length && !about.trim() && !title.trim()} onClick={() => setStep(2)}>Next: confidence</Button></div>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          {skills.length ? <div className="space-y-3">{skills.map((s) => <div key={s} className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{SKILLS.find((x) => x.id === s)?.title}</span><div className="flex gap-1">{CONF.map((c) => <button key={c.v} title={c.l} aria-label={`${c.l} about ${s}`} onClick={() => setConf((cur) => ({ ...cur, [s]: c.v }))} className={cx('rounded-xl px-2 py-1 text-xl', conf[s] === c.v ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-surface-2')}>{c.e}</button>)}</div></div>)}</div> : <p className="text-sm text-muted">We’ll infer topics from your description.</p>}
          <Textarea label="How well do you understand the material right now? (optional)" value={understanding} onChange={(e) => setUnderstanding(e.target.value)} />
          <Toggle checked={calc} onChange={setCalc} label="Calculator allowed" />
          <div><p className="mb-2 text-sm font-semibold">Test format</p><div className="flex flex-wrap gap-2">{['Mixed', 'Multiple choice', 'Short answer', 'Written response'].map((f) => <Chip key={f} selected={format === f} onClick={() => setFormat(f)}>{f}</Chip>)}</div></div>
          <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(1)}>Back</Button><Button loading={busy} onClick={create}>Create my study plan</Button></div>
        </div>
      )}
      <div className="mt-4 flex justify-center gap-1.5">{[0, 1, 2].map((i) => <span key={i} className={cx('h-1.5 w-8 rounded-full', i <= step ? 'bg-accent' : 'bg-surface-2')} />)}</div>
      <p className="mt-3 text-center text-xs text-muted"><Badge>Tip</Badge> Plans adapt automatically if you miss a day.</p>
    </Modal>
  );
}
