import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { onCelebrate, type Achievement } from '../lib/celebrate.ts';
import { useApp } from '../lib/store.tsx';
import { Button } from './ui.tsx';

interface Toast { id: number; text: string; tone: 'info' | 'success' | 'error' | 'xp' }
let seq = 0;

export function Celebrations() {
  const { refreshProfiles } = useApp();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [queue, setQueue] = useState<({ kind: 'achievement'; a: Achievement } | { kind: 'level'; level: number })[]>([]);
  useEffect(() => onCelebrate((e) => {
    if (e.type === 'xp') { push(`+${e.amount} XP`, 'xp'); refreshProfiles().catch(() => {}); }
    if (e.type === 'toast') push(e.message, e.tone ?? 'info');
    if (e.type === 'achievement') setQueue((q) => [...q, { kind: 'achievement', a: e.achievement }]);
    if (e.type === 'levelup') setQueue((q) => [...q, { kind: 'level', level: e.level }]);
  }), [refreshProfiles]);
  function push(text: string, tone: Toast['tone']) {
    const id = ++seq; setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5000 : 2600);
  }
  const current = queue[0];
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: -16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} className={`pointer-events-auto rounded-2xl px-4 py-2.5 text-sm font-bold shadow-lg ${t.tone === 'xp' ? 'bg-brand text-white' : t.tone === 'success' ? 'bg-success text-white' : t.tone === 'error' ? 'bg-danger text-white' : 'card'}`} role={t.tone === 'error' ? 'alert' : 'status'}>
              {t.tone === 'xp' ? '⚡ ' : ''}{t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {current && (
          <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div role="dialog" aria-label={current.kind === 'achievement' ? 'Achievement unlocked' : 'Level up'} className="card relative w-full max-w-sm overflow-hidden p-8 text-center" initial={{ scale: 0.7, rotate: -4 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
              <div className="bg-brand absolute inset-x-0 top-0 h-28 opacity-15" />
              {current.kind === 'achievement' ? (
                <>
                  <p className="relative text-xs font-bold uppercase tracking-widest text-accent">Achievement unlocked</p>
                  <motion.div className="relative mx-auto my-4 grid h-24 w-24 place-items-center rounded-3xl bg-accent-soft text-6xl" animate={{ rotate: [0, -8, 8, 0] }} transition={{ duration: 0.8 }}>{current.a.icon}</motion.div>
                  <h2 className="text-2xl font-extrabold">{current.a.title}</h2>
                  <p className="mt-1 text-muted">{current.a.description}</p>
                  <p className="mt-3 font-bold text-success">+{current.a.xp} XP</p>
                </>
              ) : (
                <>
                  <p className="relative text-xs font-bold uppercase tracking-widest text-accent">Level up!</p>
                  <motion.div className="bg-brand relative mx-auto my-4 grid h-24 w-24 place-items-center rounded-full text-4xl font-extrabold text-white" initial={{ scale: 0.5 }} animate={{ scale: [0.5, 1.15, 1] }}>{current.level}</motion.div>
                  <h2 className="text-2xl font-extrabold">You reached Level {current.level}</h2>
                  <p className="mt-1 text-muted">Check Progress to see what you’ve unlocked.</p>
                </>
              )}
              <Button className="mt-6 w-full" onClick={() => setQueue((q) => q.slice(1))} autoFocus>Awesome!</Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
