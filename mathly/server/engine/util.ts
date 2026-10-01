import type { Question } from '../../shared/types.ts';

export type Draft = Omit<Question, 'id' | 'skillId' | 'difficulty' | 'source'>;
export type Rng = () => number;

/** Deterministic PRNG (mulberry32) so daily challenges and mock tests are reproducible. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

export const ri = (r: Rng, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
export const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
export const shuffle = <T>(r: Rng, arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const nz = (r: Rng, a: number, b: number) => { let v = 0; while (v === 0) v = ri(r, a, b); return v; };
export const sign = (r: Rng) => (r() < 0.5 ? -1 : 1);

export const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
export const lcm = (a: number, b: number) => Math.abs(a * b) / gcd(a, b);
export const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
export const nCr = (n: number, k: number) => Math.round(fact(n) / (fact(k) * fact(n - k)));
export const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

/** Plain-number string, trimmed: 3, 0.25, -1.5 (no thousands separators) */
export const n = (x: number) => {
  if (Number.isInteger(x)) return String(x);
  return String(parseFloat(x.toFixed(6)));
};
/** Display number with thousands separators */
export const dn = (x: number) => (Math.abs(x) >= 10000 ? x.toLocaleString('en-US') : n(x));
export const money = (x: number) => `$${x.toFixed(2)}`;

/** Simplified fraction as string ("3/4", "2", "-1/3"). */
export function frac(num: number, den: number): string {
  if (den < 0) { num = -num; den = -den; }
  const g = gcd(num, den) || 1;
  const a = num / g, b = den / g;
  return b === 1 ? String(a) : `${a}/${b}`;
}
export const isSimplified = (num: number, den: number) => gcd(num, den) === 1;

/** Signed term helpers for pretty algebra display. */
export const term = (coef: number, v: string, first = false): string => {
  if (coef === 0) return '';
  const abs = Math.abs(coef);
  const body = v ? `${abs === 1 ? '' : abs}${v}` : `${abs}`;
  if (first) return coef < 0 ? `−${body}` : body;
  return coef < 0 ? ` − ${body}` : ` + ${body}`;
};
/** Build polynomial display & mathjs strings from [coef, power] pairs. */
export function poly(terms: [number, number][], v = 'x') {
  const nonzero = terms.filter(([c]) => c !== 0);
  if (!nonzero.length) return { show: '0', math: '0' };
  const sup = (p: number) => (p === 1 ? v : p === 0 ? '' : `${v}${superscript(p)}`);
  const show = nonzero.map(([c, p], i) => {
    const abs = Math.abs(c);
    const body = p === 0 ? String(abs) : `${abs === 1 ? '' : abs}${sup(p)}`;
    return (i === 0 ? (c < 0 ? '−' : '') : c < 0 ? ' − ' : ' + ') + body;
  }).join('');
  const math = nonzero.map(([c, p]) => `(${c})*${v}^${p}`).join(' + ');
  return { show, math };
}
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
export const superscript = (p: number | string) => String(p).split('').map((c) => SUP[c] ?? c).join('');

/** Multiple-choice helper: unique choices with the correct answer inserted at a random position. */
export function choices(r: Rng, correct: string, distractors: string[], count = 4): string[] {
  const set: string[] = [correct];
  for (const d of distractors) if (!set.includes(d) && set.length < count) set.push(d);
  return shuffle(r, set);
}

/** UNDERSTAND → PLAN → SOLVE → CHECK framework, used by every worked solution. */
export function frame(understand: string, plan: string, solve: string[], check: string): string[] {
  return [`UNDERSTAND: ${understand}`, `PLAN: ${plan}`, ...solve.map((s) => `SOLVE: ${s}`), `CHECK: ${check}`];
}
