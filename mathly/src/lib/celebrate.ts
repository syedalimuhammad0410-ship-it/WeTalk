import confetti from 'canvas-confetti';

export interface Achievement { id: string; title: string; description: string; icon: string; xp: number }
export type CelebrationEvent =
  | { type: 'xp'; amount: number; reason?: string }
  | { type: 'achievement'; achievement: Achievement }
  | { type: 'levelup'; level: number }
  | { type: 'toast'; message: string; tone?: 'info' | 'success' | 'error' };

const listeners = new Set<(e: CelebrationEvent) => void>();
export const onCelebrate = (fn: (e: CelebrationEvent) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const emit = (e: CelebrationEvent) => listeners.forEach((l) => l(e));
export const toast = (message: string, tone: 'info' | 'success' | 'error' = 'info') => emit({ type: 'toast', message, tone });

const reduced = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
export function confettiBurst(big = false) {
  if (reduced()) return;
  const colors = ['#5b5bf0', '#8b5cf6', '#f59e0b', '#22c55e', '#ec4899'];
  confetti({ particleCount: big ? 160 : 70, spread: big ? 100 : 65, origin: { y: 0.65 }, colors, scalar: big ? 1.1 : 0.9, disableForReducedMotion: true });
}

/** Handle the common reward payload returned by the API. */
export function celebrate(r: { xp?: number; achievements?: Achievement[]; levelUp?: number | null }) {
  if (r.xp) emit({ type: 'xp', amount: r.xp });
  for (const a of r.achievements ?? []) emit({ type: 'achievement', achievement: a });
  if (r.levelUp) emit({ type: 'levelup', level: r.levelUp });
  if ((r.achievements?.length ?? 0) > 0 || r.levelUp) confettiBurst(true);
}
