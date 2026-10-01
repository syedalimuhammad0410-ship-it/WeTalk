import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { Badge, PageHeader } from '../components/ui.tsx';

export const MODES = [
  { id: 'practice', icon: '🎯', title: 'Practice', desc: 'Adaptive problems on your recommended skills.', color: '#6366f1' },
  { id: 'mental', icon: '⚡', title: 'Mental Math', desc: 'Fast calculations in your head — no paper.', color: '#eab308' },
  { id: 'puzzle', icon: '🧩', title: 'Puzzles', desc: 'Logic, patterns and number puzzles.', color: '#ef4444' },
  { id: 'game', icon: '🎮', title: 'Number Blitz', desc: 'Game mode: 3 lives, combos and a high score.', color: '#ec4899', minLevel: 2 },
  { id: 'visual', icon: '🖼️', title: 'Visual', desc: 'Diagrams, graphs and models to reason with.', color: '#0ea5e9' },
  { id: 'tutor', icon: '💬', title: 'Tutor Mode', desc: 'Practice with the tutor guiding every step.', color: '#8b5cf6' },
  { id: 'challenge', icon: '🏔️', title: 'Challenge', desc: 'Harder-than-grade-level questions.', color: '#a855f7', minLevel: 6 },
  { id: 'speed', icon: '⏱️', title: 'Speed', desc: '60 seconds — how many can you solve?', color: '#f97316' },
  { id: 'realworld', icon: '🌍', title: 'Real World', desc: 'Money, travel, cooking, sports, business.', color: '#10b981' },
  { id: 'review', icon: '🔁', title: 'Review', desc: 'Spaced review of skills that are fading.', color: '#14b8a6' },
] as const;

export default function Practice() {
  const { profile } = useApp();
  const level = profile?.level ?? 1;
  return (
    <div>
      <PageHeader title="Practice" subtitle="Choose a mode. Every question adapts to your mastery — and every answer is checked by our math engine." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m, i) => {
          const locked = 'minLevel' in m && level < m.minLevel;
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link to={locked ? '#' : `/practice/session?mode=${m.id}`} aria-disabled={locked} onClick={(e) => locked && e.preventDefault()} className={`card group flex h-full items-start gap-4 p-5 transition ${locked ? 'opacity-60' : 'hover:-translate-y-0.5 hover:shadow-lg'}`}>
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl" style={{ background: `${m.color}1f` }}>{m.icon}</span>
                <span className="min-w-0"><span className="flex items-center gap-2 font-bold">{m.title}{locked && <Badge><Lock className="h-3 w-3" />Level {(m as { minLevel: number }).minLevel}</Badge>}</span><span className="mt-1 block text-sm text-muted">{m.desc}</span></span>
              </Link>
            </motion.div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-sm text-muted">Looking for a specific topic? Open the <Link to="/skills" className="font-semibold text-accent">Skill Tree</Link> or press <kbd className="rounded border border-border px-1">⌘K</kbd> to search.</p>
    </div>
  );
}
