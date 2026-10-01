import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, Video, Keyboard, Square, RotateCcw, Play, ShieldCheck } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { celebrate, toast } from '../lib/celebrate.ts';
import { speechSupported, useDictation } from '../lib/speech.ts';
import { Badge, Button, Card, Input, PageHeader, Progress, Ring, Tabs, Textarea, cx } from '../components/ui.tsx';

interface Topic { id: string; title: string; prompt: string; concepts: string[] }
interface Feedback {
  topic: { title: string }; overall: number; scores: Record<string, number | null>; wordCount: number; wpm: number | null; fillerCount: number; fillers: { f: string; n: number }[]; longPauses: number;
  conceptsCovered: { label: string; covered: boolean }[]; vocabularyUsed: string[]; mathChecked: string[]; mathErrors: string[]; strengths: string[]; improvements: string[]; missingConcepts: string[];
  ai?: { summary: string; strengths: string[]; improvements: string[]; missingConcepts: string[]; mathIssues: string[] };
}
type Mode = 'voice' | 'video' | 'typed';

export default function Presentation() {
  const { data } = useFetch<{ topics: Topic[] }>('/me/presentations/topics');
  const history = useFetch<{ sessions: { id: string; topic_title: string; mode: string; score: number; created_at: string }[] }>('/me/presentations');
  const [topic, setTopic] = useState<Topic | null>(null);
  const [custom, setCustom] = useState('');
  const [mode, setMode] = useState<Mode>(speechSupported() ? 'voice' : 'typed');
  const [typed, setTyped] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const dict = useDictation({ continuous: true });
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => { if (!recording) return; const t = setInterval(() => setSeconds((s) => s + 1), 1000); return () => clearInterval(t); }, [recording]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function startRec() {
    setFeedback(null); setMediaUrl(null); setSeconds(0); dict.reset(); chunks.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia(mode === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true });
      streamRef.current = stream;
      if (mode === 'video' && videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; await videoRef.current.play().catch(() => {}); }
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => { const blob = new Blob(chunks.current, { type: rec.mimeType }); setMediaUrl(URL.createObjectURL(blob)); stream.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; };
      rec.start(); recRef.current = rec;
      if (speechSupported()) dict.start();
      setRecording(true);
    } catch { toast('We couldn’t access your microphone/camera. Check permissions, or type your explanation instead.', 'error'); }
  }
  function stopRec() { recRef.current?.stop(); dict.stop(); setRecording(false); }

  async function analyze() {
    if (!topic) return;
    const transcript = mode === 'typed' ? typed : dict.transcript;
    if (transcript.trim().split(/\s+/).length < 5) return toast('Say or write a little more so we can give useful feedback.', 'info');
    setBusy(true);
    try {
      const r = await post<{ feedback: Feedback; xp: number; achievements: never[] }>('/me/presentations', { topicId: topic.id, customTitle: custom, mode, transcript, durationSec: mode === 'typed' ? null : seconds, pauses: mode === 'typed' ? [] : dict.pauses });
      setFeedback(r.feedback); celebrate(r); history.reload();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  const reset = () => { setFeedback(null); setMediaUrl(null); setTyped(''); dict.reset(); setSeconds(0); };

  if (!topic) return (
    <div>
      <PageHeader icon={<Mic className="h-7 w-7 text-accent" />} title="Presentation Practice" subtitle="Explain a math idea out loud (or in writing) and get feedback on accuracy, clarity, organization and reasoning." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.topics.map((t) => <button key={t.id} onClick={() => setTopic(t)} className="card p-5 text-left transition hover:-translate-y-0.5"><p className="font-bold">{t.id === 'custom' ? '✏️ ' : '🎤 '}{t.title}</p><p className="mt-1 text-sm text-muted">{t.prompt}</p></button>)}
      </div>
      {!!history.data?.sessions.length && <section className="mt-8"><h2 className="mb-3 text-lg font-bold">Recent practice</h2><div className="space-y-2">{history.data.sessions.map((s) => <Card key={s.id} className="flex items-center justify-between p-4"><span className="font-semibold">{s.topic_title} <Badge>{s.mode}</Badge></span><span className="font-bold">{Math.round(s.score)}/100</span></Card>)}</div></section>}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={() => { setTopic(null); reset(); }} className="mb-3 text-sm font-semibold text-muted hover:text-text">← All topics</button>
      <PageHeader title={topic.id === 'custom' && custom ? custom : topic.title} subtitle={topic.prompt} />
      {!feedback ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <Card className="p-6">
            {topic.id === 'custom' && <div className="mb-4"><Input label="Your topic" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Why dividing by zero is undefined" maxLength={120} /></div>}
            <Tabs tabs={[{ id: 'voice', label: <span className="flex items-center gap-1.5"><Mic className="h-4 w-4" />Voice</span> }, { id: 'video', label: <span className="flex items-center gap-1.5"><Video className="h-4 w-4" />Video</span> }, { id: 'typed', label: <span className="flex items-center gap-1.5"><Keyboard className="h-4 w-4" />Typed</span> }]} value={mode} onChange={(m) => { if (!recording) { setMode(m); reset(); } }} />
            {mode === 'typed' ? (
              <div className="mt-5"><Textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Write your explanation as if you were presenting it to your class…" className="min-h-56" aria-label="Your explanation" /></div>
            ) : (
              <div className="mt-5">
                {mode === 'video' && <video ref={videoRef} className={cx('mb-4 aspect-video w-full rounded-2xl bg-black object-cover', !recording && !mediaUrl && 'hidden')} playsInline />}
                {mediaUrl && !recording && (mode === 'video' ? <video src={mediaUrl} controls className="mb-4 aspect-video w-full rounded-2xl bg-black" /> : <audio src={mediaUrl} controls className="mb-4 w-full" />)}
                <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-2 p-6">
                  <motion.button onClick={recording ? stopRec : startRec} animate={recording ? { scale: [1, 1.06, 1] } : {}} transition={{ repeat: Infinity, duration: 1.4 }} className={cx('grid h-20 w-20 place-items-center rounded-full text-white shadow-lg', recording ? 'bg-danger' : 'bg-brand')} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <Square className="h-8 w-8" /> : mode === 'video' ? <Video className="h-8 w-8" /> : <Mic className="h-8 w-8" />}</motion.button>
                  <p className="font-mono text-2xl font-bold">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>
                  <p className="text-sm text-muted">{recording ? 'Recording… explain clearly, then press stop.' : mediaUrl ? 'Review your recording and transcript, then get feedback.' : 'Press to start. Aim for 1–3 minutes.'}</p>
                </div>
                {!speechSupported() && <p className="mt-3 text-sm text-warn">Live transcription isn’t supported in this browser. After recording, type a summary of what you said below.</p>}
                <div className="mt-4"><Textarea label="Transcript (you can fix any recognition errors)" value={`${dict.transcript}${dict.interim ? ` ${dict.interim}` : ''}`} onChange={(e) => dict.setTranscript(e.target.value)} className="min-h-32" /></div>
                <p className="mt-2 flex items-center gap-1 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" />Your {mode === 'video' ? 'video' : 'audio'} stays on this device. Only the transcript is sent for feedback.</p>
              </div>
            )}
            <Button size="lg" className="mt-5" loading={busy} disabled={recording || (topic.id === 'custom' && !custom.trim())} onClick={analyze}>Get feedback</Button>
          </Card>
          <aside className="space-y-4">
            <Card className="p-5"><h2 className="font-bold">A strong explanation…</h2><ul className="mt-2 space-y-1.5 text-sm text-muted">{topic.concepts.map((c) => <li key={c}>• {c}</li>)}</ul></Card>
            <Card className="p-5 text-sm text-muted"><h2 className="mb-1 font-bold text-text">Structure tip</h2>Understand → Plan → Solve → Check → <strong className="text-text">Communicate</strong>: define the idea, show an example, explain why it works, then summarize.</Card>
          </aside>
        </div>
      ) : (
        <div className="space-y-5">
          <Card className="flex flex-wrap items-center gap-6 p-6">
            <Ring value={feedback.overall} size={120} stroke={10} color={feedback.overall >= 80 ? 'var(--success)' : feedback.overall >= 60 ? 'var(--accent)' : 'var(--warn)'}><div className="text-3xl font-extrabold">{feedback.overall}</div></Ring>
            <div className="min-w-0 flex-1 space-y-2">
              {Object.entries(feedback.scores).filter(([, v]) => v !== null).map(([k, v]) => <div key={k}><div className="mb-0.5 flex justify-between text-sm"><span className="font-semibold capitalize">{k === 'accuracy' ? 'Mathematical accuracy' : k}</span><span>{v}</span></div><Progress value={v as number} label={k} /></div>)}
            </div>
          </Card>
          {feedback.ai?.summary && <Card className="p-5"><p className="font-bold">Tutor summary</p><p className="mt-1">{feedback.ai.summary}</p></Card>}
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="p-5"><h2 className="font-bold">💪 What went well</h2><ul className="mt-2 space-y-1.5 text-sm">{[...feedback.strengths, ...(feedback.ai?.strengths ?? [])].map((s, i) => <li key={i}>• {s}</li>)}</ul></Card>
            <Card className="p-5"><h2 className="font-bold">🎯 To improve</h2><ul className="mt-2 space-y-1.5 text-sm">{[...feedback.improvements, ...(feedback.ai?.improvements ?? []), ...(feedback.ai?.mathIssues ?? [])].map((s, i) => <li key={i}>• {s}</li>)}</ul></Card>
          </div>
          <Card className="p-5">
            <h2 className="font-bold">Key concepts</h2>
            <div className="mt-2 flex flex-wrap gap-2">{feedback.conceptsCovered.map((c) => <Badge key={c.label} tone={c.covered ? 'success' : 'neutral'}>{c.covered ? '✓' : '○'} {c.label}</Badge>)}</div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-2xl bg-surface-2 p-3"><div className="text-xl font-extrabold">{feedback.wordCount}</div><div className="text-muted">words</div></div>
              <div className="rounded-2xl bg-surface-2 p-3"><div className="text-xl font-extrabold">{feedback.wpm ?? '—'}</div><div className="text-muted">words / min</div></div>
              <div className="rounded-2xl bg-surface-2 p-3"><div className="text-xl font-extrabold">{feedback.fillerCount}</div><div className="text-muted">filler words</div></div>
              <div className="rounded-2xl bg-surface-2 p-3"><div className="text-xl font-extrabold">{feedback.longPauses}</div><div className="text-muted">long pauses</div></div>
            </div>
            {feedback.mathChecked.length > 0 && <p className="mt-3 text-sm text-muted">Calculations checked: {feedback.mathChecked.join(', ')} {feedback.mathErrors.length ? '' : '— all correct ✓'}</p>}
          </Card>
          <div className="flex gap-2"><Button icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>Try again</Button><Button variant="secondary" icon={<Play className="h-4 w-4" />} onClick={() => { setTopic(null); reset(); }}>Another topic</Button></div>
        </div>
      )}
    </div>
  );
}
