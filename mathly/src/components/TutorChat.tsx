import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, Send, Trash2, Volume2, VolumeX, Headphones } from 'lucide-react';
import { del, get, post, patch, errMsg } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { speak, speechSupported, stopSpeaking, ttsSupported, useDictation } from '../lib/speech.ts';
import type { TutorContext } from '../lib/tutorBus.ts';
import { LogoMark } from './Logo.tsx';
import { Badge, Button, RichText, cx } from './ui.tsx';

interface Msg { role: 'user' | 'assistant'; content: string; source?: string; error?: boolean }
const SUGGESTIONS_Q = ['Give me a hint', 'Don’t tell me the answer', 'Explain this like I’m 10', 'Show me an example', 'Why is my answer wrong?', 'Next step'];
const SUGGESTIONS = ['Explain fractions', 'Quiz me', 'Make it harder', 'Explain this at university level', 'Solve 3x + 5 = 20 with me', 'What is a derivative?'];

export function TutorChat({ context, className, autoPrompt }: { context?: TutorContext; className?: string; autoPrompt?: string }) {
  const { profile, prefs, setPrefs, aiConfigured } = useApp();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const voiceReplies = prefs.voiceReplies === true;
  const endRef = useRef<HTMLDivElement>(null);
  const sentAuto = useRef(false);
  const dict = useDictation({ continuous: false, onFinal: (t) => { if (handsFreeRef.current) send(t); else setInput((cur) => `${cur}${cur ? ' ' : ''}${t}`); } });
  const handsFreeRef = useRef(false); handsFreeRef.current = handsFree;

  useEffect(() => {
    get<{ conversationId: string | null; messages: Msg[] }>('/me/tutor/history').then((r) => { if (!context?.questionId && !context?.homeworkId) { setMessages(r.messages); setConversationId(r.conversationId); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);
  useEffect(() => { if (autoPrompt && !sentAuto.current) { sentAuto.current = true; send(autoPrompt); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [autoPrompt]);

  async function send(text = input) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput(''); setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    try {
      const r = await post<{ reply: string; source: string; conversationId: string }>('/me/tutor', { message: msg, conversationId, context });
      setConversationId(r.conversationId);
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, source: r.source }]);
      if (voiceReplies || handsFreeRef.current) speak(r.reply);
      if (handsFreeRef.current) setTimeout(() => dict.start(), 400);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: errMsg(e), error: true }]);
    } finally { setBusy(false); }
  }

  const toggleVoiceReplies = async () => { const next = { ...prefs, voiceReplies: !voiceReplies }; setPrefs(next); if (voiceReplies) stopSpeaking(); try { await patch('/me/preferences', { voiceReplies: !voiceReplies }); } catch { /* keep local */ } };
  const clear = async () => { await del('/me/tutor/history').catch(() => {}); setMessages([]); setConversationId(null); };
  const suggestions = context?.questionId || context?.homeworkId ? SUGGESTIONS_Q : SUGGESTIONS;

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <LogoMark size={28} />
        <div className="mr-auto min-w-0"><p className="font-bold leading-tight">Math Tutor</p><p className="truncate text-xs text-muted">{aiConfigured ? 'AI tutor · knows your level and progress' : 'Built-in tutor · hints, examples, quizzes'}</p></div>
        {(context?.questionId || context?.homeworkId) && <Badge tone="accent">{context.homeworkId ? 'Homework' : 'This question'}</Badge>}
        {ttsSupported() && <button onClick={toggleVoiceReplies} className="rounded-xl p-2 text-muted hover:bg-surface-2" aria-label={voiceReplies ? 'Turn off spoken replies' : 'Turn on spoken replies'} title="Spoken replies">{voiceReplies ? <Volume2 className="h-5 w-5 text-accent" /> : <VolumeX className="h-5 w-5" />}</button>}
        {speechSupported() && ttsSupported() && <button onClick={() => { const v = !handsFree; setHandsFree(v); if (v) dict.start(); else { dict.stop(); stopSpeaking(); } }} className={cx('rounded-xl p-2 hover:bg-surface-2', handsFree ? 'text-accent' : 'text-muted')} aria-pressed={handsFree} aria-label="Hands-free voice tutoring" title="Hands-free mode"><Headphones className="h-5 w-5" /></button>}
        {!!messages.length && <button onClick={clear} className="rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="Clear conversation" title="Clear conversation"><Trash2 className="h-5 w-5" /></button>}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {!messages.length && (
          <div className="py-6 text-center">
            <p className="text-lg font-bold">Hi {profile?.name ?? 'there'}! What are you stuck on?</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">I’ll help you think it through — with questions, hints and examples — rather than just handing you answers.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[88%] rounded-2xl px-4 py-2.5 text-[0.95rem]', m.role === 'user' ? 'rounded-br-md bg-brand text-white' : m.error ? 'rounded-bl-md bg-warn-soft' : 'rounded-bl-md bg-surface-2')}>
              <RichText text={m.content} />
              {m.role === 'assistant' && !m.error && ttsSupported() && <button onClick={() => speak(m.content)} className="mt-1 text-xs font-semibold text-muted hover:text-accent" aria-label="Read aloud">🔊 Listen</button>}
            </div>
          </motion.div>
        ))}
        {busy && <div className="flex gap-1 px-2" aria-label="Tutor is thinking">{[0, 1, 2].map((d) => <motion.span key={d} className="h-2 w-2 rounded-full bg-accent" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: d * 0.15 }} />)}</div>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="scrollbar-thin mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {suggestions.map((s) => <button key={s} onClick={() => send(s)} disabled={busy} className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-accent hover:text-accent">{s}</button>)}
        </div>
        {(dict.listening || dict.interim) && <p className="mb-2 text-sm text-accent">🎙️ {dict.interim || 'Listening…'}</p>}
        {dict.error && <p className="mb-2 text-sm text-warn">{dict.error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} placeholder="Ask anything… e.g. “Why do I divide by 3 here?”" aria-label="Message the tutor" className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent focus:ring-4 focus:ring-accent/15" />
          {speechSupported() && <Button type="button" variant={dict.listening ? 'danger' : 'secondary'} size="icon" className="h-12 w-12" onClick={() => (dict.listening ? dict.stop() : dict.start())} aria-label={dict.listening ? 'Stop voice input' : 'Speak to the tutor'}>{dict.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</Button>}
          <Button type="submit" size="icon" className="h-12 w-12" loading={busy} disabled={!input.trim()} aria-label="Send"><Send className="h-5 w-5" /></Button>
        </form>
      </div>
    </div>
  );
}
