import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Wand2, Send, Sparkles, Loader2 } from 'lucide-react';
import { useApp, useFetch } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { celebrate } from '../lib/celebrate.ts';
import { Badge, Button, Card, Chip, Input, PageHeader, Tabs, Textarea } from '../components/ui.tsx';

const EXAMPLES = ['I want to learn calculus.', 'I want to learn mathematical finance.', 'The math used in engineering', 'How do mortgages work?', 'University linear algebra', 'The mathematics behind rockets', 'Probability', 'Grade 10 trigonometry', 'Prepare for an Olympiad'];
const LEVELS = ['Beginner', 'School', 'Advanced', 'University', 'Expert'];
const STYLES = ['Visual', 'Practice', 'AI tutor', 'Videos', 'Articles', 'Projects', 'Real-world examples', 'Tests'];

export default function LearnAnything() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'build' | 'request'>(params.get('tab') === 'request' ? 'request' : 'build');
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={<Wand2 className="h-7 w-7 text-accent" />} title="Learn Anything" subtitle="Tell me what you want to learn. If we don’t have the course yet, we’ll build a learning path for you." />
      <div className="mb-6"><Tabs tabs={[{ id: 'build', label: '✨ Build my learning path' }, { id: 'request', label: '📮 Request a topic' }]} value={tab} onChange={setTab} /></div>
      {tab === 'build' ? <Builder initial={params.get('topic') ?? ''} /> : <RequestForm />}
      <MyRequests />
    </div>
  );
}

function Builder({ initial }: { initial: string }) {
  const { aiConfigured } = useApp();
  const nav = useNavigate();
  const [topic, setTopic] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; suggestions: { id: string; title: string }[] } | null>(null);
  const [error, setError] = useState('');
  async function build(t = topic) {
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await post<{ courseId: string | null; message: string; suggestions: { id: string; title: string }[]; achievements: never[] }>('/me/learn-anything', { topic: t });
      celebrate(r);
      if (r.courseId) nav(`/learn/${r.courseId}`); else setResult(r);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Card className="p-6 sm:p-8">
      <label htmlFor="topic" className="text-lg font-bold">What do you want to learn?</label>
      <form onSubmit={(e) => { e.preventDefault(); build(); }} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. I want to learn the math used in investment banking" maxLength={200} className="h-14 flex-1 rounded-2xl border-2 border-border bg-surface px-4 text-lg outline-none focus:border-accent" />
        <Button type="submit" size="lg" loading={busy} disabled={topic.trim().length < 2} icon={<Sparkles className="h-5 w-5" />}>Build my learning path</Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => { setTopic(e); build(e); }} disabled={busy} className="rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-muted hover:border-accent hover:text-accent">{e}</button>)}</div>
      {busy && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 flex items-center gap-3 rounded-2xl bg-accent-soft p-4 text-sm font-semibold text-accent"><Loader2 className="h-5 w-5 animate-spin" />Analyzing prerequisites, checking what you already know and designing your path{aiConfigured ? ' — new lessons are verified by our math engine…' : '…'}</motion.div>}
      {error && <p className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{error}</p>}
      {result && (
        <div className="mt-6 rounded-2xl bg-warn-soft p-5">
          <p className="font-semibold">{result.message}</p>
          {result.suggestions.length > 0 && <><p className="mt-3 text-sm">Related lessons you can start right now:</p><div className="mt-2 flex flex-wrap gap-2">{result.suggestions.map((s) => <Link key={s.id} to={`/lesson/${s.id}`}><Badge tone="accent">{s.title}</Badge></Link>)}</div></>}
        </div>
      )}
      <div className="mt-6 grid gap-3 text-sm text-muted sm:grid-cols-3">
        <div className="rounded-2xl bg-surface-2 p-3"><strong className="text-text">1. Prerequisites</strong><br />We check what you already know and add short reviews for gaps.</div>
        <div className="rounded-2xl bg-surface-2 p-3"><strong className="text-text">2. Ordered units</strong><br />Concepts in the right order, from foundations to advanced.</div>
        <div className="rounded-2xl bg-surface-2 p-3"><strong className="text-text">3. Mastery checks</strong><br />Practice, challenges and checkpoints to prove you’ve got it.</div>
      </div>
    </Card>
  );
}

function RequestForm() {
  const nav = useNavigate();
  const [topic, setTopic] = useState(''); const [reason, setReason] = useState(''); const [level, setLevel] = useState('School'); const [style, setStyle] = useState('Practice');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  async function submit() {
    setBusy(true); setMsg('');
    try {
      const r = await post<{ courseId: string | null; message: string; achievements: never[] }>('/me/learn-anything', { topic, reason, level, style });
      celebrate(r);
      if (r.courseId) nav(`/learn/${r.courseId}`); else setMsg(r.message);
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Card className="space-y-5 p-6 sm:p-8">
      <Input label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Game development math" maxLength={200} />
      <Textarea label="Why do you want to learn it?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I’m building my first 3D game" maxLength={500} />
      <div><p className="mb-2 text-sm font-semibold">How advanced?</p><div className="flex flex-wrap gap-2">{LEVELS.map((l) => <Chip key={l} selected={level === l} onClick={() => setLevel(l)}>{l}</Chip>)}</div></div>
      <div><p className="mb-2 text-sm font-semibold">Preferred learning style</p><div className="flex flex-wrap gap-2">{STYLES.map((s) => <Chip key={s} selected={style === s} onClick={() => setStyle(s)}>{s}</Chip>)}</div></div>
      {msg && <p className="rounded-xl bg-warn-soft p-3 text-sm">{msg}</p>}
      <Button size="lg" loading={busy} disabled={topic.trim().length < 2} onClick={submit} icon={<Send className="h-4 w-4" />}>Build My Course</Button>
      <p className="text-xs text-muted">Every request is saved. Our team reviews the most requested topics to add them to the permanent curriculum.</p>
    </Card>
  );
}

function MyRequests() {
  const { data } = useFetch<{ requests: { id: string; topic: string; course_id: string | null; status: string; created_at: string }[] }>('/me/topic-requests');
  if (!data?.requests.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold">Your requests</h2>
      <div className="space-y-2">{data.requests.map((r) => <Card key={r.id} className="flex items-center gap-3 p-4"><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.topic}</span><span className="text-xs text-muted">{new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()} · {r.status}</span></span>{r.course_id ? <Link to={`/learn/${r.course_id}`}><Button size="sm" variant="soft">Open path</Button></Link> : <Badge>Saved</Badge>}</Card>)}</div>
    </section>
  );
}
