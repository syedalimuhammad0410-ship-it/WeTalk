// Built-in problem analyzer used by the homework helper and tutor when no AI provider is configured,
// and as an independent verifier of AI answers. Deterministic and conservative: if it cannot be
// sure, it says so instead of guessing.
import { math, normalizeExpr, safeNumeric } from './check.ts';

export interface Highlight { text: string; kind: 'given' | 'asked' | 'value' | 'unit' | 'keyword' }
export interface TutorStep { prompt: string; expected?: string; hint: string; explanation: string }
export interface Analysis {
  kind: 'linear' | 'quadratic' | 'arithmetic' | 'word' | 'unknown';
  problem: string;
  understand: string;
  given: { label: string; value: string }[];
  asked: string;
  plan: string;
  concept: string;
  steps: TutorStep[];
  check: string;
  finalAnswer: string | null;
  communicate: string | null;
  highlights: Highlight[];
  verified: boolean;
  verification?: { kind: 'equation' | 'numeric'; expr: string; variable?: string };
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(4))));
const UNIT_RE = /(-?\d+(?:\.\d+)?)\s*(cm²|m²|cm|mm|km\/h|km|kg|m\/s|m|g|ml|l|°|%|dollars|\$|hours?|hrs?|minutes?|mins?|seconds?|units?|miles?|mph)?/gi;

export function extractHighlights(text: string): Highlight[] {
  const hs: Highlight[] = [];
  const q = text.split(/(?<=[.?!])\s+/).find((s) => /\?|^(find|what|how|calculate|solve|determine|evaluate|simplify|work out|show)/i.test(s.trim()));
  if (q) hs.push({ text: q.trim(), kind: 'asked' });
  for (const m of text.matchAll(/\$?\d+(?:\.\d+)?\s*(?:cm²|m²|cm|mm|km\/h|km|kg|m\/s|m|g|ml|°|%|hours?|minutes?|seconds?|miles?|mph)?/g)) hs.push({ text: m[0].trim(), kind: m[0].match(/[a-z%°²$]/i) ? 'unit' : 'value' });
  for (const kw of ['area', 'perimeter', 'length', 'width', 'radius', 'diameter', 'base', 'height', 'speed', 'distance', 'time', 'percent', 'interest', 'total', 'average', 'probability', 'slope', 'solve for', 'hypotenuse']) {
    const m = text.match(new RegExp(`\\b${kw}\\b`, 'i')); if (m) hs.push({ text: m[0], kind: 'keyword' });
  }
  return hs;
}

/** Fit f(v) = lhs − rhs as a polynomial of degree ≤ 2 by sampling; returns null if it isn't one. */
function fitPoly(lhs: string, rhs: string, v: string): [number, number, number] | null {
  try {
    const f = math.compile(`(${lhs}) - (${rhs})`);
    const at = (x: number) => Number(f.evaluate({ [v]: x }));
    const f0 = at(0), f1 = at(1), f2 = at(2), f3 = at(3), f5 = at(-1.5);
    const a = (f2 - 2 * f1 + f0) / 2, b = f1 - f0 - a, c = f0;
    const pred = (x: number) => a * x * x + b * x + c;
    if (Math.abs(pred(3) - f3) > 1e-6 || Math.abs(pred(-1.5) - f5) > 1e-6) return null;
    return [Math.round(a * 1e9) / 1e9, Math.round(b * 1e9) / 1e9, Math.round(c * 1e9) / 1e9];
  } catch { return null; }
}

/** Pull "3x + 5 = 20" out of "Find x if 3x + 5 = 20." */
export function extractEquation(text: string): [string, string, string] | null {
  const idx = text.indexOf('=');
  if (idx < 0 || text.indexOf('=', idx + 1) >= 0) return null;
  const mathTok = (t: string) => /^[0-9a-z+\-*/^().×÷−²³]+$/i.test(t) && !/[a-z]{2,}/i.test(t.replace(/sqrt|sin|cos|tan|log|ln/gi, ''));
  const left = text.slice(0, idx).trim().split(/\s+/); const right = text.slice(idx + 1).trim().replace(/[.,;!?]+$/, '').split(/\s+/);
  const l: string[] = []; for (let i = left.length - 1; i >= 0 && mathTok(left[i]); i--) l.unshift(left[i]);
  const r: string[] = []; for (const t of right) { if (!mathTok(t.replace(/[.,;!?]+$/, ''))) break; r.push(t.replace(/[.,;!?]+$/, '')); }
  if (!l.length || !r.length) return null;
  return [`${l.join(' ')} = ${r.join(' ')}`, l.join(' '), r.join(' ')];
}

function base(problem: string): Analysis {
  return { kind: 'unknown', problem, understand: '', given: [], asked: '', plan: '', concept: '', steps: [], check: '', finalAnswer: null, communicate: null, highlights: extractHighlights(problem), verified: false };
}

export function analyzeProblem(raw: string): Analysis {
  const problem = raw.trim().slice(0, 2000);
  const a = base(problem);
  const eqMatch = extractEquation(problem);
  // ── Equations in one variable
  if (eqMatch) {
    const lhs = normalizeExpr(eqMatch[1]), rhs = normalizeExpr(eqMatch[2]);
    const vars = [...new Set(`${lhs} ${rhs}`.match(/[a-z]/gi) ?? [])].filter((c) => !['e'].includes(c));
    if (vars.length === 1) {
      const v = vars[0]; const coeffs = fitPoly(lhs, rhs, v);
      if (coeffs) {
        const [qa, qb, qc] = coeffs;
        if (qa === 0 && qb !== 0) {
          const sol = -qc / qb;
          return {
            ...a, kind: 'linear', understand: `We need the value of ${v} that makes both sides equal.`, asked: `Find ${v}.`,
            given: [{ label: 'Equation', value: `${eqMatch[1].trim()} = ${eqMatch[2].trim()}` }],
            concept: 'Inverse operations keep the equation balanced.',
            plan: `Get all ${v}-terms on one side and the numbers on the other, then undo multiplication by dividing.`,
            steps: [
              { prompt: `Simplify each side first. After collecting terms, the equation is equivalent to ${fmt(qb)}${v} ${qc <= 0 ? '=' : '='} ${fmt(-qc)}. What operation undoes "× ${fmt(qb)}"?`, expected: 'divide', hint: `${v} is being multiplied by ${fmt(qb)}.`, explanation: `Divide both sides by ${fmt(qb)}.` },
              { prompt: `Now divide both sides by ${fmt(qb)}. What is ${v}?`, expected: fmt(sol), hint: `${fmt(-qc)} ÷ ${fmt(qb)}`, explanation: `${v} = ${fmt(-qc)} ÷ ${fmt(qb)} = ${fmt(sol)}.` },
            ],
            check: `Substitute ${v} = ${fmt(sol)} back into the original equation — both sides should match.`,
            finalAnswer: `${v} = ${fmt(sol)}`, communicate: `Solving ${eqMatch[1].trim()} = ${eqMatch[2].trim()} with inverse operations gives ${v} = ${fmt(sol)}; substituting it back makes both sides equal.`,
            verified: true, verification: { kind: 'equation', expr: `${lhs}=${rhs}`, variable: v },
          };
        }
        if (qa !== 0) {
          const disc = qb * qb - 4 * qa * qc;
          if (disc < 0) return { ...a, kind: 'quadratic', understand: `A quadratic equation in ${v}.`, asked: `Solve for ${v}.`, concept: 'The discriminant b² − 4ac decides how many real solutions exist.', plan: 'Compute the discriminant.', steps: [{ prompt: `Here a = ${fmt(qa)}, b = ${fmt(qb)}, c = ${fmt(qc)}. What is b² − 4ac?`, expected: fmt(disc), hint: 'Square b, then subtract 4ac.', explanation: `b² − 4ac = ${fmt(disc)} < 0.` }], check: 'A negative discriminant means no real solutions.', finalAnswer: 'No real solutions', communicate: `The discriminant is ${fmt(disc)}, which is negative, so the equation has no real solutions.`, verified: true };
          const r1 = (-qb + Math.sqrt(disc)) / (2 * qa), r2 = (-qb - Math.sqrt(disc)) / (2 * qa);
          const roots = [...new Set([r1, r2].map((x) => fmt(x)))];
          return {
            ...a, kind: 'quadratic', understand: `This is a quadratic equation; we want every value of ${v} that makes it true.`, asked: `Solve for ${v}.`,
            given: [{ label: 'Standard form', value: `${fmt(qa)}${v}² + ${fmt(qb)}${v} + ${fmt(qc)} = 0` }],
            concept: Number.isInteger(r1) && Number.isInteger(r2) ? 'Factoring and the zero-product property.' : 'The quadratic formula.',
            plan: 'Rearrange to ax² + bx + c = 0, identify a, b, c, then factor or use the quadratic formula.',
            steps: [
              { prompt: `In standard form, a = ${fmt(qa)}, b = ${fmt(qb)}, c = ${fmt(qc)}. What is the discriminant b² − 4ac?`, expected: fmt(disc), hint: `(${fmt(qb)})² − 4(${fmt(qa)})(${fmt(qc)})`, explanation: `b² − 4ac = ${fmt(disc)}.` },
              { prompt: `Use x = (−b ± √disc) / 2a. What are the solutions? (separate with a comma)`, expected: roots.join(', '), hint: `√${fmt(disc)} ≈ ${fmt(Math.sqrt(disc))}`, explanation: `${v} = ${roots.join(' or ')}.` },
            ],
            check: `Substitute each solution back in; each should make the equation true.`, finalAnswer: `${v} = ${roots.join(' or ')}`,
            communicate: `The solutions are ${v} = ${roots.join(' and ')}.`, verified: true,
          };
        }
      }
    }
  }
  // ── Pure arithmetic
  const arith = problem.replace(/^(evaluate|calculate|compute|what is|work out|simplify)\s*:?\s*/i, '').replace(/[?=]\s*$/, '');
  if (/^[\d\s+\-*/^().×÷−,²³]+$/.test(arith) && /\d/.test(arith) && /[+\-*/^×÷−²³]/.test(arith)) {
    const v = safeNumeric(arith);
    if (v !== null) return {
      ...a, kind: 'arithmetic', understand: 'Evaluate the expression to a single number.', asked: 'The value of the expression.',
      given: [{ label: 'Expression', value: arith.trim() }], concept: 'Order of operations (brackets, exponents, × ÷, + −).',
      plan: 'Work inside brackets first, then exponents, then multiplication/division left to right, then addition/subtraction.',
      steps: [{ prompt: 'Which operation should you do first?', hint: 'Look for brackets or exponents first.', explanation: 'Brackets → exponents → × ÷ → + −.' }, { prompt: 'Carry out the operations in order. What value do you get?', expected: fmt(v), hint: 'Keep track of each intermediate result.', explanation: `The value is ${fmt(v)}.` }],
      check: 'Estimate roughly to confirm the size of the answer.', finalAnswer: fmt(v), communicate: `${arith.trim()} = ${fmt(v)} using the order of operations.`, verified: true, verification: { kind: 'numeric', expr: normalizeExpr(arith) },
    };
  }
  return wordProblem(problem, a);
}

function nums(text: string, word: string): number | null {
  const m = text.match(new RegExp(`${word}[^\\d]{0,25}(\\d+(?:\\.\\d+)?)`, 'i')) ?? text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:cm|m|mm|km|in|ft|units?)?\\s*(?:long|wide)?[^.\\d]{0,6}${word}`, 'i'));
  return m ? Number(m[1]) : null;
}
const unitOf = (t: string) => (t.match(/\b(cm|mm|km|m|in|ft)\b/)?.[1] ?? 'units');

function wordProblem(t: string, a: Analysis): Analysis {
  const lower = t.toLowerCase();
  const mk = (o: Partial<Analysis>, answer: number, unit: string, label: string, expr: string): Analysis => ({
    ...a, kind: 'word', ...o, finalAnswer: `${fmt(answer)}${unit ? ` ${unit}` : ''}`, verified: true, verification: { kind: 'numeric', expr },
    communicate: o.communicate ?? `The ${label} is ${fmt(answer)}${unit ? ` ${unit}` : ''}.`,
  });
  // Rectangle area / perimeter
  if (/rectangle|room|garden|field/.test(lower) && (/area|perimeter|fence|around/.test(lower))) {
    const l = nums(t, 'length') ?? nums(t, 'long'); const w = nums(t, 'width') ?? nums(t, 'wide');
    const all = [...t.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    const L = l ?? all[0], W = w ?? all[1];
    if (L && W) {
      const u = unitOf(t); const area = /area/.test(lower);
      const ans = area ? L * W : 2 * (L + W);
      return mk({
        understand: `We need the ${area ? 'area (space inside)' : 'perimeter (distance around)'} of a rectangle.`, asked: area ? 'The area.' : 'The perimeter.',
        given: [{ label: 'Length', value: `${L} ${u}` }, { label: 'Width', value: `${W} ${u}` }], concept: area ? 'Area of a rectangle' : 'Perimeter of a rectangle',
        plan: area ? 'Use A = length × width.' : 'Use P = 2(length + width).',
        steps: [{ prompt: `Which formula connects length and width to the ${area ? 'area' : 'perimeter'}?`, hint: area ? 'Think of rows of unit squares.' : 'Add all four sides.', explanation: area ? 'A = l × w' : 'P = 2(l + w)' }, { prompt: `Substitute: what is ${area ? `${L} × ${W}` : `2(${L} + ${W})`}?`, expected: fmt(ans), hint: area ? `${L} × ${W}` : `${L} + ${W} = ${L + W}`, explanation: `${fmt(ans)}` }],
        check: area ? `Units should be square ${u} (${u}²).` : `Perimeter should be longer than any single side.`,
        communicate: area ? `The rectangle has a length of ${L} ${u} and a width of ${W} ${u}. Using A = length × width, ${L} × ${W} = ${fmt(ans)}, so the area is ${fmt(ans)} ${u}².` : `Using P = 2(l + w) = 2(${L} + ${W}) = ${fmt(ans)}, the perimeter is ${fmt(ans)} ${u}.`,
      }, ans, area ? `${u}²` : u, area ? 'area' : 'perimeter', area ? `${L}*${W}` : `2*(${L}+${W})`);
    }
  }
  // Percent of
  const pct = lower.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*\$?(\d+(?:\.\d+)?)/);
  if (pct) {
    const p = Number(pct[1]), n = Number(pct[2]); const ans = (p / 100) * n;
    return mk({ understand: `Find ${p}% of ${n}.`, asked: `${p}% of ${n}`, given: [{ label: 'Percent', value: `${p}%` }, { label: 'Amount', value: `${n}` }], concept: 'Percent means per hundred.', plan: 'Convert the percent to a decimal and multiply.', steps: [{ prompt: `Write ${p}% as a decimal.`, expected: fmt(p / 100), hint: 'Divide by 100.', explanation: `${p}% = ${fmt(p / 100)}` }, { prompt: `Multiply ${fmt(p / 100)} × ${n}.`, expected: fmt(ans), hint: '10% first can help.', explanation: fmt(ans) }], check: p < 100 ? `The answer should be less than ${n}.` : `The answer should be more than ${n}.` }, ans, '', `${p}% of ${n}`, `${p}/100*${n}`);
  }
  // Triangle area
  if (/triangle/.test(lower) && /area/.test(lower)) {
    const b = nums(t, 'base'), h = nums(t, 'height');
    if (b && h) { const ans = (b * h) / 2; const u = unitOf(t); return mk({ understand: 'Find the area of a triangle.', asked: 'The area.', given: [{ label: 'Base', value: `${b} ${u}` }, { label: 'Height', value: `${h} ${u}` }], concept: 'A triangle is half a rectangle.', plan: 'Use A = ½ × base × height.', steps: [{ prompt: 'What is base × height?', expected: fmt(b * h), hint: `${b} × ${h}`, explanation: fmt(b * h) }, { prompt: 'Now take half of that.', expected: fmt(ans), hint: 'Divide by 2.', explanation: fmt(ans) }], check: `Units are ${u}².` }, ans, `${u}²`, 'area', `${b}*${h}/2`); }
  }
  // Circle
  if (/circle/.test(lower) && /radius|diameter/.test(lower)) {
    let r = nums(t, 'radius'); const d = nums(t, 'diameter'); if (!r && d) r = d / 2;
    if (r) { const area = /area/.test(lower); const ans = Math.round((area ? Math.PI * r * r : 2 * Math.PI * r) * 100) / 100; const u = unitOf(t); return mk({ understand: `Find the ${area ? 'area' : 'circumference'} of a circle.`, asked: area ? 'Area' : 'Circumference', given: [{ label: 'Radius', value: `${r} ${u}` }], concept: area ? 'A = πr²' : 'C = 2πr', plan: area ? 'Square the radius, multiply by π.' : 'Multiply 2 × π × r.', steps: [{ prompt: area ? `What is r² ?` : 'What is 2r?', expected: fmt(area ? r * r : 2 * r), hint: area ? `${r} × ${r}` : `2 × ${r}`, explanation: fmt(area ? r * r : 2 * r) }, { prompt: 'Multiply by π (≈ 3.14159). Round to 2 decimal places.', expected: fmt(ans), hint: 'Use a calculator.', explanation: fmt(ans) }], check: 'Rounded to 2 decimal places.' }, ans, area ? `${u}²` : u, area ? 'area' : 'circumference', area ? `round(pi*${r}^2,2)` : `round(2*pi*${r},2)`); }
  }
  // Speed / distance / time
  const sp = lower.match(/(\d+(?:\.\d+)?)\s*(km\/h|mph|km per hour|miles per hour)/);
  const tm = lower.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?)/);
  if (sp && tm && /how far|distance/.test(lower)) {
    const s = Number(sp[1]), h = Number(tm[1]); const ans = s * h; const u = sp[2].startsWith('km') ? 'km' : 'miles';
    return mk({ understand: 'Find the distance travelled.', asked: 'Distance', given: [{ label: 'Speed', value: `${s} ${sp[2]}` }, { label: 'Time', value: `${h} hours` }], concept: 'distance = speed × time', plan: 'Multiply speed by time.', steps: [{ prompt: `What is ${s} × ${h}?`, expected: fmt(ans), hint: 'Speed × time.', explanation: fmt(ans) }], check: 'Units: (km/h) × h = km.' }, ans, u, 'distance', `${s}*${h}`);
  }
  // Right triangle legs
  if (/right/.test(lower) && /triangle/.test(lower) && /hypotenuse/.test(lower)) {
    const all = [...t.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    if (all.length >= 2) { const [p, q] = all; const ans = Math.round(Math.hypot(p, q) * 100) / 100; return mk({ understand: 'Find the hypotenuse of a right triangle.', asked: 'Hypotenuse', given: [{ label: 'Legs', value: `${p} and ${q}` }], concept: 'Pythagorean theorem a² + b² = c²', plan: 'Square the legs, add, take the square root.', steps: [{ prompt: `What is ${p}² + ${q}²?`, expected: fmt(p * p + q * q), hint: 'Square each leg first.', explanation: fmt(p * p + q * q) }, { prompt: 'Take the square root.', expected: fmt(ans), hint: `√${fmt(p * p + q * q)}`, explanation: fmt(ans) }], check: 'The hypotenuse must be the longest side.' }, ans, '', 'hypotenuse', `round(sqrt(${p}^2+${q}^2),2)`); }
  }
  // Unknown: still provide the thinking framework honestly.
  const numbers = [...t.matchAll(UNIT_RE)].map((m) => m[0].trim()).filter((s) => /\d/.test(s)).slice(0, 8);
  return {
    ...a, kind: 'unknown',
    understand: 'Read the problem carefully and restate it in your own words. What situation is described?',
    given: numbers.map((v, i) => ({ label: `Value ${i + 1}`, value: v })), asked: a.highlights.find((h) => h.kind === 'asked')?.text ?? 'Look for the sentence with a question mark or "find".',
    concept: 'Match the question to a formula or method you know.', plan: 'List what you know, name what you need, and choose a method that links them.',
    steps: [{ prompt: 'What is the question asking you to find?', hint: 'Look for words like "find", "how many", "what is".', explanation: 'Name the unknown first.' }, { prompt: 'Which information in the problem do you need?', hint: 'Numbers with units are usually important.', explanation: 'Underline the given values.' }, { prompt: 'Which formula or method connects them?', hint: 'Think about the topic you are studying.', explanation: 'Choose the method, then substitute.' }],
    check: 'Does your answer make sense? Check units and size.', finalAnswer: null, communicate: null, verified: false,
  };
}
