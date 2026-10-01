import { ACCENT_THEMES } from '../../shared/curriculum.ts';

export type ThemeMode = 'light' | 'dark' | 'system';
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getTheme(): ThemeMode {
  try { return (localStorage.getItem('mathly.theme') as ThemeMode) || 'system'; } catch { return 'system'; }
}
export function setTheme(mode: ThemeMode) {
  try { localStorage.setItem('mathly.theme', mode); } catch { /* ignore */ }
  applyTheme(mode);
}
export function applyTheme(mode: ThemeMode = getTheme()) {
  const dark = mode === 'dark' || (mode === 'system' && !!mq?.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0c13' : '#5b5bf0');
}
mq?.addEventListener('change', () => applyTheme());

/** Per-profile display preferences (accessibility + unlocked accent themes). */
export function applyDisplayPrefs(p: Record<string, unknown>) {
  const root = document.documentElement;
  root.classList.toggle('high-contrast', p.highContrast === true);
  root.classList.toggle('reduce-motion', p.reducedMotion === true);
  root.classList.toggle('text-lg-mode', p.textSize === 'large');
  root.classList.toggle('text-xl-mode', p.textSize === 'xlarge');
  const accent = ACCENT_THEMES[String(p.accent ?? 'default')] ?? ACCENT_THEMES.default;
  if (p.accent && p.accent !== 'default') { root.style.setProperty('--accent', accent.accent); root.style.setProperty('--accent-2', accent.accent2); }
  else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-2'); }
  if (typeof p.theme === 'string' && ['light', 'dark', 'system'].includes(p.theme)) setTheme(p.theme as ThemeMode);
}
