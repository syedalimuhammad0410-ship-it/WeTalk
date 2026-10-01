import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, FileUp, Keyboard, CheckCircle2, ChevronRight, MessageCircle, Eye, Trash2, ShieldCheck, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useApp, useFetch } from '../lib/store.tsx';
import { del, get, patch, post, errMsg } from '../lib/api.ts';
import { celebrate, toast } from '../lib/celebrate.ts';
import { openTutor } from '../lib/tutorBus.ts';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, Progress, RichText, Textarea, cx } from '../components/ui.tsx';

type Box = { x: number; y: number; w: number; h: number };
interface Step { prompt: string; hint: string; explanation?: string }
interface Session {
  id: string; hasImage: boolean; mime: string | null; problemText: string | null; step: number; completed: boolean;
  analysis: {
    source?: string; unreadable?: boolean; needsText?: boolean; message?: string; aiError?: boolean; verified?: boolean; verifyNote?: string | null;
    problems?: { text: string; bbox: Box | null }[]; regions?: { label: string; kind: string; explanation: string; bbox: Box }[];
    highlights?: { text: string; kind: string }[]; studentWork?: { present: boolean; assessment: string; errorStep: string } | null;
    tutoring: { understand: string; asked: string; given: { label: string; value: string }[]; concept: string; plan: string; steps: Step[]; check: string; finalAnswer: string | null; communicate: string | null } | null;
  };
}

export default function Homework() {
  const { id } = useParams();
  return id ? <SessionView id={id} /> : <Start />;
}

async function downscale(file: File): Promise<{ data: string; mime: string }> {
  const read = () => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  if (file.type === 'application/pdf' || file.type === 'image/gif') return { data: await read(), mime: file.type };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/jpeg', 0.88), mime: 'image/jpeg' };
  } catch { return { data: await read(), mime: file.type }; } finally { URL.revokeObjectURL(url); }
}

function Start() {
  const { aiConfigured } = useApp();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const camRef = useRef<HTMLInputElement>(null);
  const history = useFetch<{ sessions: { id: string; problem_text: string | null; completed: number; created_at: string; has_image: number }[] }>('/me/homework');

  async function upload(file: File) {
    if (file.size > 20 * 1024 * 1024) return toast('That file is too large. Please use an image under 8 MB.', 'error');
    if (!/^(image\/(png|jpeg|webp|gif|heic)|application\/pdf)$/.test(file.type)) return toast('Please upload a photo (PNG/JPG/WEBP) or a PDF.', 'error');
    setBusy(true);
    try { const { data } = await downscale(file); const r = await post<{ session: Session }>('/me/homework', { image: data }); nav(`/homework/${r.session.id}`); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function submitText() {
    setBusy(true);
    try { const r = await post<{ session: Session }>('/me/homework', { text }); nav(`/homework/${r.session.id}`); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <div>
      <PageHeader title="Homework Helper" subtitle="I’ll help you understand it — step by step — instead of just giving you the answer." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className={cx('flex flex-col items-center justify-center border-2 border-dashed p-8 text-center transition', drag && 'border-accent bg-accent-soft')} onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e: React.DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}>
          <div className="bg-brand grid h-16 w-16 place-items-center rounded-3xl text-white"><Camera className="h-8 w-8" /></div>
          <h2 className="mt-4 text-xl font-bold">Snap or upload your homework</h2>
          <p className="mt-1 text-sm text-muted">Photo, screenshot or PDF. {aiConfigured ? 'I’ll find the problem, highlight what matters and guide you.' : 'Photo reading needs the AI vision service — you can always type the problem instead.'}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button loading={busy} icon={<Camera className="h-4 w-4" />} onClick={() => camRef.current?.click()}>Take photo</Button>
            <Button variant="secondary" disabled={busy} icon={<FileUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>Upload file</Button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <p className="mt-4 flex items-center gap-1 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" />Images are stored privately for your profile only. Delete them any time.</p>
        </Card>
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Keyboard className="h-5 w-5 text-accent" />Or type the problem</h2>
          <div className="mt-4"><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'e.g. Find x if 3x + 5 = 20\nor: A rectangle has a length of 8 cm and a width of 6 cm. Find its area.'} aria-label="Homework problem" maxLength={2000} /></div>
          <Button className="mt-3" loading={busy} disabled={text.trim().length < 3} onClick={submitText}>Help me understand it</Button>
        </Card>
      </div>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold">Recent homework</h2>
        {history.data?.sessions.length ? (
          <div className="grid gap-3 sm:grid-cols-2">{history.data.sessions.map((s) => <Link key={s.id} to={`/homework/${s.id}`} className="card flex items-center gap-3 p-4 hover:-translate-y-0.5 transition"><span className="text-2xl">{s.has_image ? '📸' : '✏️'}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{s.problem_text ?? 'Photo problem'}</span><span className="text-xs text-muted">{new Date(s.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</span></span>{s.completed ? <CheckCircle2 className="h-5 w-5 text-success" /> : <ChevronRight className="h-5 w-5 text-muted" />}</Link>)}</div>
        ) : <EmptyState icon="📒" title="No homework yet" body="Your homework sessions will appear here." />}
      </section>
    </div>
  );
}

const PHASES = ['Understand', 'Identify', 'Plan', 'Solve', 'Check', 'Communicate'] as const;

function SessionView({ id }: { id: string }) {
  const nav = useNavigate();
  const [s, setS] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);
  const [answer, setAnswer] = useState('');
  const [attempt, setAttempt] = useState(1);
  const [stepFeedback, setStepFeedback] = useState<{ correct: boolean; text: string } | null>(null);
  const [region, setRegion] = useState<number | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [statement, setStatement] = useState('');

  useEffect(() => { get<{ session: Session }>(`/me/homework/${id}`).then((r) => { setS(r.session); if (r.session.completed) setPhase(5); }).catch((e) => setError(errMsg(e))); }, [id]);
  useEffect(() => {
    if (!s?.hasImage || s.mime === 'application/pdf') return;
    let url: string | null = null;
    fetch(`/api/me/homework/${id}/image`, { headers: { 'x-profile-id': localStorage.getItem('mathly.profile') ?? '' } }).then((r) => r.blob()).then((b) => { url = URL.createObjectURL(b); setImgUrl(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [s?.hasImage, s?.mime, id]);

  if (error) return <ErrorState message={error} />;
  if (!s) return <PageSkeleton />;
  const a = s.analysis; const t = a.tutoring;

  async function provideText() {
    setBusy(true);
    try { const r = await patch<{ session: Session }>(`/me/homework/${id}`, { text: typed }); setS(r.session); setPhase(0); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function submitStep(skip = false) {
    setBusy(true);
    try {
      const r = await post<{ correct: boolean; feedback: string; explanation: string | null; advanced: boolean; session: Session }>(`/me/homework/${id}/step`, { answer, skip, attempt });
      setS(r.session);
      setStepFeedback({ correct: r.correct, text: r.advanced && r.explanation ? `${r.feedback} ${r.explanation}` : r.feedback });
      if (r.advanced) { setAnswer(''); setAttempt(1); if (r.session.step >= (r.session.analysis.tutoring?.steps.length ?? 0)) setTimeout(() => setPhase(4), 900); } else setAttempt((n) => n + 1);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function complete() {
    try { const r = await post<{ xp: number; achievements: never[]; session: Session }>(`/me/homework/${id}/complete`); setS(r.session); celebrate(r); toast('Nice work — homework problem complete!', 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  }

  const needsText = a.needsText || a.unreadable;
  const highlight = (txt: string) => {
    const hs = (a.highlights ?? []).filter((h) => h.kind !== 'asked').map((h) => h.text).filter(Boolean).sort((x, y) => y.length - x.length);
    if (!hs.length) return txt;
    const re = new RegExp(`(${hs.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    return txt.split(re).map((part, i) => (hs.includes(part) ? <mark key={i} className="rounded-md bg-warn-soft px-1 font-semibold text-text" title="Important information">{part}</mark> : part));
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => nav('/homework')} className="rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="mr-auto text-2xl font-extrabold">Homework Helper</h1>
        {a.source === 'ai' && <Badge tone="accent">AI vision + math engine</Badge>}
        {a.source === 'builtin' && <Badge>Built-in solver</Badge>}
        <Button variant="ghost" size="sm" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => { if (confirm('Delete this homework and its image?')) { await del(`/me/homework/${id}`); nav('/homework'); } }}>Delete</Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <Card className="p-4">
          {s.hasImage && imgUrl && (
            <div className="relative overflow-hidden rounded-2xl">
              <img src={imgUrl} alt="Your homework" className="w-full" />
              {(a.regions ?? []).map((r, i) => (
                <button key={i} onClick={() => setRegion(i)} aria-label={`${r.kind}: ${r.label}`} className={cx('absolute rounded-lg border-2 transition', region === i ? 'border-accent bg-accent/25' : r.kind === 'mistake' ? 'border-danger/80 bg-danger/10' : r.kind === 'asked' ? 'border-sky-500/80 bg-sky-500/10' : 'border-warn/80 bg-warn/10')} style={{ left: `${r.bbox.x}%`, top: `${r.bbox.y}%`, width: `${r.bbox.w}%`, height: `${r.bbox.h}%` }} />
              ))}
            </div>
          )}
          {s.hasImage && s.mime === 'application/pdf' && <p className="rounded-2xl bg-surface-2 p-4 text-sm">📄 PDF uploaded.</p>}
          {region !== null && a.regions?.[region] && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-2xl bg-accent-soft p-3 text-sm"><Badge tone="accent">{a.regions[region].kind}</Badge> <strong>{a.regions[region].label}</strong><p className="mt-1">{a.regions[region].explanation}</p></motion.div>}
          {(a.regions?.length ?? 0) > 0 && <p className="mt-2 text-xs text-muted">Tap a highlighted part of the image to learn what it means.</p>}
          {s.problemText && <div className="mt-3 rounded-2xl bg-surface-2 p-4"><p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Problem</p><p className="math text-lg">{highlight(s.problemText)}</p></div>}
          {a.studentWork?.present && <div className="mt-3 rounded-2xl bg-warn-soft p-4 text-sm"><p className="font-bold">About your work</p><p className="mt-1">{a.studentWork.assessment}</p>{a.studentWork.errorStep && <p className="mt-1"><strong>Where the reasoning changed:</strong> {a.studentWork.errorStep}</p>}</div>}
          {needsText && (
            <div className="mt-3 space-y-3">
              <p className="flex items-start gap-2 rounded-2xl bg-warn-soft p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{a.message ?? 'I couldn’t clearly read this problem. Try taking a closer photo, or type it below.'}</p>
              <Textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type the problem here…" aria-label="Type the problem" />
              <Button loading={busy} disabled={typed.trim().length < 3} onClick={provideText}>Continue</Button>
            </div>
          )}
        </Card>

        {t && !needsText && (
          <div className="space-y-4">
            <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-1">
              {PHASES.map((p, i) => <button key={p} onClick={() => setPhase(i)} className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold', phase === i ? 'bg-brand text-white' : i < phase ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>{i + 1}. {p}</button>)}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={phase} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                <Card className="p-6">
                  {phase === 0 && <><h2 className="text-lg font-bold">Step 1 · Understand</h2><p className="mt-2 text-muted">First, let’s understand what we’re being asked to find.</p><RichText className="mt-3" text={t.understand} /><div className="mt-4 rounded-2xl bg-sky-500/10 p-4"><p className="text-xs font-bold uppercase tracking-wider text-sky-600 dark:text-sky-300">What is being asked</p><p className="mt-1 font-semibold">{t.asked}</p></div></>}
                  {phase === 1 && <><h2 className="text-lg font-bold">Step 2 · Identify the information</h2><p className="mt-2 text-muted">These are the values we know (highlighted in the problem).</p>{t.given.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2">{t.given.map((g, i) => <li key={i} className="rounded-2xl bg-warn-soft p-3"><span className="text-xs font-bold uppercase tracking-wider text-warn">{g.label}</span><p className="font-semibold">{g.value}</p></li>)}</ul> : <p className="mt-3 text-sm">List the numbers, variables and units you see in the problem.</p>}</>}
                  {phase === 2 && <><h2 className="text-lg font-bold">Step 3 · Plan</h2><p className="mt-2 text-muted">What mathematical idea could help us?</p><div className="mt-3 rounded-2xl bg-accent-soft p-4"><p className="text-xs font-bold uppercase tracking-wider text-accent">Concept</p><p className="font-semibold">{t.concept}</p></div><p className="mt-3">{t.plan}</p></>}
                  {phase === 3 && (
                    <>
                      <h2 className="text-lg font-bold">Step 4 · Solve — step by step</h2>
                      <div className="mt-3"><Progress value={(s.step / Math.max(1, t.steps.length)) * 100} /></div>
                      <ol className="mt-4 space-y-3">
                        {t.steps.map((st, i) => (
                          <li key={i} className={cx('rounded-2xl p-4', i < s.step ? 'bg-success-soft' : i === s.step ? 'border-2 border-accent' : 'bg-surface-2 opacity-60')}>
                            <p className="font-semibold">{i + 1}. {st.prompt}</p>
                            {i < s.step && st.explanation && <p className="mt-1 text-sm">✓ {st.explanation}</p>}
                            {i === s.step && (
                              <div className="mt-3 space-y-2">
                                <form onSubmit={(e) => { e.preventDefault(); submitStep(); }} className="flex gap-2"><input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your thinking or answer" aria-label="Your answer for this step" className="h-12 flex-1 rounded-2xl border-2 border-border bg-surface px-4 outline-none focus:border-accent" autoFocus /><Button type="submit" loading={busy} disabled={!answer.trim()}>Check</Button></form>
                                {stepFeedback && <p className={cx('text-sm font-semibold', stepFeedback.correct ? 'text-success' : 'text-warn')} role="status">{stepFeedback.text}</p>}
                                <div className="flex flex-wrap gap-3 text-sm"><button className="font-semibold text-accent" onClick={() => setStepFeedback({ correct: false, text: `Hint: ${st.hint}` })}>Hint</button><button className="font-semibold text-muted" onClick={() => submitStep(true)}>Show this step</button><button className="font-semibold text-muted" onClick={() => openTutor({ homeworkId: id, prompt: `I'm stuck on: ${st.prompt}` })}>Ask tutor</button></div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                      {s.step >= t.steps.length && <p className="mt-3 font-semibold text-success">All steps done — now let’s check it.</p>}
                    </>
                  )}
                  {phase === 4 && <><h2 className="text-lg font-bold">Step 5 · Check</h2><p className="mt-2">{t.check}</p><ul className="mt-3 space-y-1 text-sm text-muted"><li>✔ Arithmetic: redo one calculation a different way.</li><li>✔ Reasoning: does each step follow from the last?</li><li>✔ Units: is the answer in the right units?</li><li>✔ Logic: is the size of the answer sensible?</li></ul>{t.finalAnswer && t.finalAnswer !== 'hidden' && <div className="mt-4 rounded-2xl bg-success-soft p-4"><p className="text-xs font-bold uppercase tracking-wider text-success">Answer</p><p className="text-xl font-extrabold">{t.finalAnswer}</p></div>}{a.verifyNote && <p className={cx('mt-2 flex items-center gap-1 text-xs', a.verified ? 'text-success' : 'text-warn')}>{a.verified ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{a.verifyNote}</p>}</>}
                  {phase === 5 && (
                    <>
                      <h2 className="text-lg font-bold">Step 6 · Communicate</h2>
                      <p className="mt-2 text-muted">Now write the final answer as a complete mathematical statement.</p>
                      <div className="mt-3"><Textarea value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="e.g. The area is 48 cm² because 8 × 6 = 48." aria-label="Your final statement" /></div>
                      {t.communicate && <details className="mt-3 rounded-2xl bg-surface-2 p-4 text-sm"><summary className="cursor-pointer font-semibold">Compare with a model answer</summary><p className="mt-2">{t.communicate}</p></details>}
                      {!s.completed ? <Button className="mt-4" disabled={!statement.trim()} onClick={complete} icon={<CheckCircle2 className="h-4 w-4" />}>Finish problem</Button> : <p className="mt-4 font-semibold text-success">✓ Completed</p>}
                    </>
                  )}
                </Card>
              </motion.div>
            </AnimatePresence>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" disabled={phase === 0} onClick={() => setPhase((p) => p - 1)}>Back</Button>
              {phase < 5 && <Button onClick={() => setPhase((p) => p + 1)} disabled={phase === 3 && s.step < t.steps.length}>Continue<ChevronRight className="h-4 w-4" /></Button>}
              <Button variant="ghost" icon={<MessageCircle className="h-4 w-4" />} onClick={() => openTutor({ homeworkId: id })}>Ask tutor</Button>
              {s.step < t.steps.length && <Button variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={async () => { if (!confirm('Show the full solution? Try the steps first — it helps you learn.')) return; const r = await post<{ session: Session }>(`/me/homework/${id}/reveal`); setS(r.session); setPhase(4); }}>Show full solution</Button>}
            </div>
            {!t.finalAnswer && <p className="text-sm text-muted">This problem type can’t be solved automatically yet, but the thinking steps above still apply — and your tutor can help.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
