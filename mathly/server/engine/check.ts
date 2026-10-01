// Answer checking & deterministic mathematical verification (mathjs).
import { create, all } from 'mathjs';
import type { CheckResult, Question, Verify } from '../../shared/types.ts';

/** Trusted instance (server-generated expressions, symbolic derivatives). */
export const math = create(all, { number: 'number' });
/** Hardened instance for untrusted student / AI input: no import, parse, evaluate, createUnit… */
const userMath = create(all, { number: 'number' });
const userEvaluate = userMath.evaluate;
const userCompile = userMath.compile;
userMath.import({
  import: () => { throw new Error('disabled'); }, createUnit: () => { throw new Error('disabled'); },
  evaluate: () => { throw new Error('disabled'); }, parse: () => { throw new Error('disabled'); },
  simplify: () => { throw new Error('disabled'); }, derivative: () => { throw new Error('disabled'); },
  resolve: () => { throw new Error('disabled'); }, reviver: () => { throw new Error('disabled'); },
}, { override: true });

/** Normalise free-form student input into something mathjs can parse. */
export function normalizeExpr(raw: string): string {
  let s = String(raw ?? '').trim();
  s = s.replace(/[−–—]/g, '-').replace(/[×·∙]/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([\d.]+)/g, 'sqrt($1)');
  s = s.replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4').replace(/⁵/g, '^5');
  s = s.replace(/^\s*[a-zA-Z]\s*(\([a-z, ]*\))?\s*=\s*/, ''); // "x = 5", "y = 3x+2", "f(x) = …"
  s = s.replace(/\+\s*c\s*$/i, '').replace(/\+\s*constant\s*$/i, '');
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); // thousands separators
  s = s.replace(/\bln\(/g, 'log(');
  return s.trim();
}

function safeEval(expr: string, scope: Record<string, unknown> = {}): unknown {
  if (expr.length > 300) throw new Error('Expression too long');
  return userEvaluate(expr, { ...scope });
}

export function toNumber(raw: string): number | null {
  let s = normalizeExpr(raw).replace(/\$|¢|%|°/g, '').replace(/\s*(cm|mm|km|m|kg|g|l|ml|n|j|pa|h|hours?|minutes?|s|units?)(\^?[23²³])?\s*$/i, '').trim();
  s = s.replace(/(\d)\s*[xX]\s*(\d)/g, '$1*$2');
  if (!s) return null;
  const mixed = s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/); // 1 1/2
  if (mixed) { const w = Number(mixed[1]); return w + Math.sign(w || 1) * (Number(mixed[2]) / Number(mixed[3])); }
  if (/[a-wyzA-WYZ]/.test(s.replace(/pi|sqrt|e(?![a-z])/g, ''))) return null;
  try {
    const v = safeEval(s);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  } catch { /* not numeric */ }
  return null;
}

const close = (a: number, b: number, tol?: number) => Math.abs(a - b) <= (tol ?? Math.max(1e-6, Math.abs(b) * 1e-9));

function valuesClose(a: unknown, b: unknown, tol = 1e-6): boolean {
  const toC = (v: unknown) => (typeof v === 'number' ? { re: v, im: 0 } : v && typeof v === 'object' && 're' in v ? (v as { re: number; im: number }) : null);
  const ca = toC(a), cb = toC(b);
  if (!ca || !cb) return false;
  const scale = Math.max(1, Math.abs(cb.re), Math.abs(cb.im));
  return Math.abs(ca.re - cb.re) <= tol * scale && Math.abs(ca.im - cb.im) <= tol * scale;
}

/** Numeric equivalence of two expressions in the given variables (random sampling). */
export function equivalent(userExpr: string, refExpr: string, vars: string[], opts: { constantOffset?: boolean } = {}): boolean {
  try {
    if (userExpr.length > 300) return false;
    const u = userCompile(normalizeExpr(userExpr));
    const v = math.compile(refExpr);
    let offset: number | null = null; let tested = 0;
    for (let i = 0; i < 12; i++) {
      const scope: Record<string, number> = {};
      for (const name of vars) scope[name] = 0.37 + i * 0.731 + name.charCodeAt(0) * 0.013;
      const a = u.evaluate({ ...scope }); const b = v.evaluate({ ...scope });
      if (typeof a !== 'number' && !(a && typeof a === 'object' && 're' in a)) return false;
      if (opts.constantOffset && typeof a === 'number' && typeof b === 'number') {
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const diff = a - b; if (offset === null) offset = diff; else if (Math.abs(diff - offset) > 1e-6 * Math.max(1, Math.abs(a))) return false;
      } else if (!valuesClose(a, b, 1e-7)) return false;
      tested++;
    }
    return tested >= 6;
  } catch {
    return false;
  }
}

function parseList(raw: string): number[] | null {
  const s = normalizeExpr(raw).replace(/^\(|\)$/g, '').replace(/\b[a-z]\s*=\s*/gi, '').replace(/\s+(or|and)\s+/gi, ',').replace(/;/g, ',');
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const nums = parts.map(toNumber);
  return nums.every((x) => x !== null) ? (nums as number[]) : null;
}

const normText = (s: string) => String(s).toLowerCase().replace(/remainder/g, 'r').replace(/[−–]/g, '-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/\s+/g, '');

/** Check a student's response against a fully generated question. */
export function checkAnswer(q: Question, response: string): CheckResult {
  const raw = String(response ?? '').trim();
  if (!raw) return { correct: false, feedback: 'Type an answer, or ask for a hint if you’re stuck.' };
  const mistake = (q.mistakes ?? []).find((m) => sameAnswer(q, m.answer, raw));
  const ok = sameAnswer(q, q.answer, raw) || (q.accept ?? []).some((a) => normText(a) === normText(raw));

  if (ok && q.answerType === 'fraction' && q.requireSimplest) {
    const m = normalizeExpr(raw).match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
    if (m && gcd(Number(m[1]), Number(m[2])) !== 1) return { correct: false, nudge: true, mistakeType: 'not-simplified', feedback: 'That’s equivalent — nice! Can you simplify it to lowest terms?' };
  }
  if (ok) return { correct: true, feedback: pickPraise() };
  if (mistake) return { correct: false, mistakeType: mistake.type, feedback: mistake.message };
  return { correct: false, mistakeType: 'other', feedback: genericNudge(q) };
}

function sameAnswer(q: Question, expected: string, raw: string): boolean {
  switch (q.answerType) {
    case 'number':
    case 'fraction': {
      const a = toNumber(raw), b = toNumber(expected);
      return a !== null && b !== null && close(a, b, q.tolerance);
    }
    case 'set': {
      const a = parseList(raw), b = parseList(expected);
      if (!a || !b || a.length !== b.length) return false;
      const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
      return sa.every((v, i) => close(v, sb[i], q.tolerance ?? 1e-6));
    }
    case 'pair': {
      const a = parseList(raw), b = parseList(expected);
      return !!a && !!b && a.length === b.length && a.every((v, i) => close(v, b[i], q.tolerance ?? 1e-6));
    }
    case 'choice':
      return normText(raw) === normText(expected);
    case 'text':
      return normText(raw) === normText(expected);
    case 'expression': {
      const vars = q.variable ? [q.variable] : detectVars(expected);
      return equivalent(raw, normalizeExpr(expected), vars);
    }
    case 'antiderivative': {
      const vars = q.variable ? [q.variable] : ['x'];
      return equivalent(raw, normalizeExpr(expected), vars, { constantOffset: true });
    }
  }
  return false;
}

function detectVars(expr: string): string[] {
  const names = new Set<string>();
  try { math.parse(normalizeExpr(expr)).traverse((node) => { if ((node as { type: string }).type === 'SymbolNode') { const nm = (node as unknown as { name: string }).name; if (!['pi', 'e', 'i', 'sqrt', 'sin', 'cos', 'tan', 'log', 'exp'].includes(nm)) names.add(nm); } }); } catch { /* ignore */ }
  return [...names];
}

function gcd(a: number, b: number): number { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }
const PRAISE = ['Correct! Nice reasoning.', 'Yes — exactly right.', 'Correct! You’re building this skill.', 'Spot on.', 'Correct — great work.'];
const pickPraise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];
function genericNudge(q: Question): string {
  const msgs = ['Not quite yet — let’s figure out where the reasoning changed.', 'You’re still building this skill. Try checking each step again.', 'Close attempt. A hint might help you spot the step to revisit.'];
  if (q.answerType === 'number' && q.unit) return `${msgs[0]} (Units: ${q.unit} — enter just the number.)`;
  return msgs[Math.floor(Math.random() * msgs.length)];
}

// ─────────────────────────────────────────── Verification (used for generated & AI content)
export interface VerifyResult { ok: boolean; reason?: string }

/** Drop "common mistake" entries that coincide with the correct answer (can happen for edge-case numbers). */
export function sanitizeQuestion(q: Question): Question {
  if (!q.mistakes?.length) return q;
  return { ...q, mistakes: q.mistakes.filter((m) => { try { return !sameAnswer(q, q.answer, m.answer); } catch { return false; } }) };
}

export function verifyQuestion(q: Question): VerifyResult {
  try {
    if (!q.prompt || !q.answer) return { ok: false, reason: 'missing prompt or answer' };
    if (!q.hints?.length || !q.steps?.length) return { ok: false, reason: 'missing hints or steps' };
    if (q.difficulty < 1 || q.difficulty > 5) return { ok: false, reason: 'difficulty out of range' };
    if (q.answerType === 'choice') {
      if (!q.choices || q.choices.length < 2) return { ok: false, reason: 'choice question without choices' };
      if (new Set(q.choices).size !== q.choices.length) return { ok: false, reason: 'duplicate choices' };
      if (!q.choices.includes(q.answer)) return { ok: false, reason: 'answer not among choices' };
    }
    // The canonical answer must pass its own checker.
    if (!checkAnswer(q, q.answer).correct) return { ok: false, reason: `answer "${q.answer}" fails its own check` };
    for (const m of q.mistakes ?? []) {
      if (sameAnswer(q, q.answer, m.answer)) return { ok: false, reason: `common mistake "${m.answer}" equals the correct answer` };
    }
    return verifyAgainst(q.verify, q);
  } catch (e) {
    return { ok: false, reason: `verification error: ${(e as Error).message}` };
  }
}

function verifyAgainst(v: Verify, q: Question): VerifyResult {
  const ans = q.answer;
  switch (v.kind) {
    case 'none':
    case 'choice':
      return { ok: true };
    case 'numeric': {
      const expected = safeEval(v.expr);
      if (q.answerType === 'text') return { ok: Math.abs(Number(expected)) < 1e-9, reason: 'identity check failed' };
      const a = toNumber(ans);
      if (a === null) return { ok: false, reason: 'answer not numeric' };
      const tol = q.tolerance ?? Math.max(1e-6, Math.abs(Number(expected)) * 1e-6);
      return valuesClose(a, expected, 0) || Math.abs(a - Number(expected)) <= tol ? { ok: true } : { ok: false, reason: `numeric mismatch: answer ${a}, computed ${String(expected)}` };
    }
    case 'equation': {
      const val = toNumber(ans);
      if (val === null) return { ok: false, reason: 'answer not numeric' };
      const [lhs, rhs] = v.eq.split('=');
      const l = Number(safeEval(lhs, { [v.variable]: val })), r = Number(safeEval(rhs, { [v.variable]: val }));
      return Math.abs(l - r) < 1e-6 * Math.max(1, Math.abs(r)) ? { ok: true } : { ok: false, reason: `substitution fails: ${l} ≠ ${r}` };
    }
    case 'roots': {
      const roots = parseList(ans);
      if (!roots?.length) return { ok: false, reason: 'no roots parsed' };
      for (const root of roots) {
        const val = Number(safeEval(v.expr, { [v.variable]: root }));
        const tol = q.tolerance ? 0.05 * Math.max(1, Math.abs(root)) * 10 : 1e-6;
        if (Math.abs(val) > tol) return { ok: false, reason: `root ${root} gives ${val}` };
      }
      return { ok: true };
    }
    case 'system': {
      const vals = parseList(ans);
      if (!vals || vals.length !== v.vars.length) return { ok: false, reason: 'system answer shape' };
      const scope = Object.fromEntries(v.vars.map((k, i) => [k, vals[i]]));
      for (const eq of v.eqs) { const [l, r] = eq.split('='); if (Math.abs(Number(safeEval(l, scope)) - Number(safeEval(r, scope))) > 1e-6) return { ok: false, reason: `system eq fails: ${eq}` }; }
      return { ok: true };
    }
    case 'derivative': {
      const d = math.derivative(v.f, v.variable).toString();
      const vars = detectVars(v.f);
      return equivalent(ans, d, vars.length ? vars : [v.variable]) ? { ok: true } : { ok: false, reason: `derivative mismatch: ${ans} vs ${d}` };
    }
    case 'antiderivative': {
      const d = math.derivative(normalizeExpr(ans), v.variable).toString();
      return equivalent(d, v.f, [v.variable]) ? { ok: true } : { ok: false, reason: `antiderivative mismatch: d/dx(${ans}) = ${d} vs ${v.f}` };
    }
    case 'equivalent':
      if (!v.vars.length) {
        const a = safeEval(normalizeExpr(ans)), b = safeEval(v.expr);
        return valuesClose(a, b, 1e-7) ? { ok: true } : { ok: false, reason: 'constant expression mismatch' };
      }
      return equivalent(ans, v.expr, v.vars) ? { ok: true } : { ok: false, reason: 'expression mismatch' };
  }
  return { ok: false, reason: 'unknown verify kind' };
}

/** Evaluate a user-supplied arithmetic expression safely (used by the built-in tutor & homework solver). */
export function safeNumeric(expr: string): number | null {
  try { const v = safeEval(normalizeExpr(expr)); return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; }
}
