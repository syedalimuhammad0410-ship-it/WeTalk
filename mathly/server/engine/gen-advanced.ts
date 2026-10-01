// Question generators: algebra, functions, geometry, statistics, probability, trigonometry,
// calculus, linear algebra and discrete mathematics.
import type { Draft, Rng } from './util.ts';
import { choices, fact, frac, frame, gcd, n, nCr, nz, pick, poly, ri, round, superscript, term } from './util.ts';

type Gen = (r: Rng, d: number) => Draft;
const sgn = (v: number) => (v < 0 ? `− ${Math.abs(v)}` : `+ ${v}`);
const par = (v: number) => (v < 0 ? `(${v})` : `${v}`);

export const advancedGenerators: Record<string, Gen> = {
  // ───────────────────────── ALGEBRA
  'variables-eval': (r, d) => {
    const x = ri(r, -3 * Math.min(1, d - 1), 9) || 2, y = ri(r, 1, 6), a = ri(r, 2, 9), b = ri(r, 1, 12);
    const forms: [string, string, string][] = [
      [`${a}x + ${b}`, `${a}*x+${b}`, `x = ${x}`],
      [`x² ${sgn(-a)}x`, `x^2-${a}*x`, `x = ${x}`],
      [`${a}(x + y)`, `${a}*(x+y)`, `x = ${x}, y = ${y}`],
      [`x² + y² ${sgn(-b)}`, `x^2+y^2-${b}`, `x = ${x}, y = ${y}`],
    ];
    const [show, math, given] = forms[ri(r, 0, Math.min(3, d))];
    const val = evalSimple(math, { x, y });
    return {
      prompt: `Evaluate ${show} when ${given}.`, answerType: 'number', answer: n(val),
      hints: ['Replace each letter with its value.', 'Use brackets when substituting, then follow the order of operations.', `Substitute ${given}.`],
      steps: frame(`Evaluate ${show}.`, 'Substitute, then simplify.', [`Substitute ${given}`, `= ${val}`], 'Double-check signs and order of operations ✓'),
      explanation: `${show} = ${val} when ${given}.`, verify: { kind: 'numeric', expr: math.replaceAll('x', `(${x})`).replaceAll('y', `(${y})`) },
    };
  },
  'simplify-expr': (r, d) => {
    const a = ri(r, 2, 6), b = nz(r, -9, 9), c = nz(r, -7, 9), e = d >= 3 ? nz(r, -9, 9) : 0;
    const prompt = `${a}(x ${sgn(b)}) ${c < 0 ? '−' : '+'} ${Math.abs(c) === 1 ? '' : Math.abs(c)}x${e ? ` ${sgn(e)}` : ''}`;
    const coef = a + c, cons = a * b + e;
    const ans = `${coef === 0 ? '' : `${coef === 1 ? '' : coef === -1 ? '-' : coef}x`}${cons === 0 ? (coef === 0 ? '0' : '') : `${coef === 0 ? cons : cons < 0 ? ` - ${-cons}` : ` + ${cons}`}`}`;
    return {
      prompt: `Simplify: ${prompt}`, answerType: 'expression', answer: ans, variable: 'x',
      hints: ['Distribute first.', `Multiply ${a} by each term inside the brackets, then combine like terms.`, `${a}(x ${sgn(b)}) = ${a}x ${sgn(a * b)}.`],
      steps: frame(`Simplify ${prompt}.`, 'Distribute, then collect like terms.', [`${a}x ${sgn(a * b)} ${c < 0 ? '−' : '+'} ${Math.abs(c)}x${e ? ` ${sgn(e)}` : ''}`, `= ${ans}`], 'Substitute x = 1 into both forms to check they match ✓'),
      explanation: `${prompt} simplifies to ${ans}.`, verify: { kind: 'equivalent', expr: `${a}*(x+${b})+${c}*x+${e}`, vars: ['x'] },
      mistakes: [{ answer: `${a + c}x + ${b + e}`, type: 'partial-distribution', message: `Remember to multiply BOTH terms in the brackets by ${a}.` }],
    };
  },
  'one-step-eq': (r, d) => {
    const x = ri(r, d >= 3 ? -12 : 1, 15) || 4, a = ri(r, 2, 12); const kind = ri(r, 0, 3);
    const forms: [string, string, string][] = [
      [`x + ${a} = ${x + a}`, `x+${a}=${x + a}`, `Subtract ${a} from both sides.`],
      [`x − ${a} = ${x - a}`, `x-${a}=${x - a}`, `Add ${a} to both sides.`],
      [`${a}x = ${a * x}`, `${a}*x=${a * x}`, `Divide both sides by ${a}.`],
      [`x ÷ ${a} = ${x}`, `x/${a}=${x}`, `Multiply both sides by ${a}.`],
    ];
    const [show, eq, move] = forms[kind]; const ans = kind === 3 ? x * a : x;
    return {
      prompt: `Solve: ${show}`, answerType: 'number', answer: n(ans), variable: 'x',
      hints: ['What operation is being done to x?', 'Use the inverse operation on both sides to keep the balance.', move],
      steps: frame(`Find x in ${show}.`, 'Undo the operation with its inverse.', [move, `x = ${ans}`], `Substitute: ${show.replace('x', `(${ans})`)} ✓`),
      explanation: `x = ${ans}. ${move}`, verify: { kind: 'equation', eq, variable: 'x' },
      mistakes: kind === 0 ? [{ answer: n(x + 2 * a), type: 'wrong-inverse', message: `You added ${a}. To undo "+ ${a}", subtract ${a} from both sides.` }] : kind === 2 ? [{ answer: n(a * x - a), type: 'subtracted', message: `${a}x means ${a} times x — divide by ${a} to undo it.` }] : [],
    };
  },
  'two-step-eq': (r, d) => {
    const x = d >= 3 ? nz(r, -10, 12) : ri(r, 1, 12); const a = d >= 4 ? nz(r, -9, 9) : ri(r, 2, 9); const b = nz(r, -15, 20); const c = a * x + b;
    const lhs = `${term(a, 'x', true)} ${sgn(b)}`;
    return {
      prompt: `Solve: ${lhs} = ${c}`, answerType: 'number', answer: n(x), variable: 'x',
      hints: [`What is being done to x? It is multiplied by ${a}, then ${b < 0 ? `${-b} is subtracted` : `${b} is added`}.`, 'Undo in reverse order: first undo the + or −, then the × or ÷.', `${b < 0 ? `Add ${-b} to` : `Subtract ${b} from`} both sides: ${term(a, 'x', true)} = ${c - b}.`],
      steps: frame(`Find x in ${lhs} = ${c}.`, 'Undo addition/subtraction, then multiplication.', [`${term(a, 'x', true)} = ${c} ${sgn(-b)} = ${c - b}`, `x = ${c - b} ÷ ${par(a)} = ${x}`], `${a}(${x}) ${sgn(b)} = ${a * x + b} = ${c} ✓`),
      explanation: `x = ${x}. We undo "${sgn(b)}" first, then divide by ${a}. Substituting back gives ${c}, so it checks out.`, verify: { kind: 'equation', eq: `${a}*x+${b}=${c}`, variable: 'x' },
      mistakes: [{ answer: n((c + b) / a), type: 'wrong-inverse', message: `You're close — check the second step. To undo "${sgn(b)}" we do the opposite.` }, { answer: n(c / a - b), type: 'wrong-order', message: 'Close! Undo the addition/subtraction BEFORE dividing.' }],
    };
  },
  'multi-step-eq': (r) => {
    const x = nz(r, -8, 10), a = ri(r, 2, 6), b = nz(r, -6, 6); let c = nz(r, -5, 7); while (c === a) c = nz(r, -5, 7); const dd = a * (x + b) - c * x;
    const show = `${a}(x ${sgn(b)}) = ${term(c, 'x', true)} ${sgn(dd)}`;
    return {
      prompt: `Solve: ${show}`, answerType: 'number', answer: n(x), variable: 'x',
      hints: ['Start by simplifying the left side.', 'Distribute, then collect x-terms on one side and numbers on the other.', `${a}x ${sgn(a * b)} = ${term(c, 'x', true)} ${sgn(dd)}.`],
      steps: frame(`Solve ${show}.`, 'Distribute, collect, isolate.', [`${a}x ${sgn(a * b)} = ${term(c, 'x', true)} ${sgn(dd)}`, `${a - c}x = ${dd - a * b}`, `x = ${x}`], `Left: ${a}(${x} ${sgn(b)}) = ${a * (x + b)}; right: ${c}(${x}) ${sgn(dd)} = ${c * x + dd} ✓`),
      explanation: `x = ${x}.`, verify: { kind: 'equation', eq: `${a}*(x+${b})=${c}*x+${dd}`, variable: 'x' },
    };
  },
  inequalities: (r, d) => {
    const x = nz(r, -8, 8), a = d >= 3 ? -ri(r, 2, 6) : ri(r, 2, 6), b = nz(r, -10, 10); const c = a * x + b; const op = pick(r, ['<', '>', '≤', '≥']);
    const flip: Record<string, string> = { '<': '>', '>': '<', '≤': '≥', '≥': '≤' }; const finalOp = a < 0 ? flip[op] : op;
    const ascii: Record<string, string> = { '<': '<', '>': '>', '≤': '<=', '≥': '>=' };
    return {
      prompt: `Solve: ${term(a, 'x', true)} ${sgn(b)} ${op} ${c}   (answer like x > 3 or x <= -2)`, answerType: 'text', answer: `x ${ascii[finalOp]} ${x}`,
      accept: [`x${ascii[finalOp]}${x}`, `${x}${ascii[flip[finalOp]]}x`],
      hints: ['Solve it like an equation first.', 'If you multiply or divide both sides by a NEGATIVE number, flip the inequality sign.', `${term(a, 'x', true)} ${op} ${c - b}.`],
      steps: frame('Solve the inequality.', 'Isolate x; flip the sign if dividing by a negative.', [`${term(a, 'x', true)} ${op} ${c - b}`, `x ${finalOp} ${x}${a < 0 ? ' (sign flipped: divided by a negative)' : ''}`], `Test a value: x = ${finalOp.includes('>') ? x + 1 : x - 1} satisfies the original ✓`),
      explanation: `x ${finalOp} ${x}.`, verify: { kind: 'none', reason: 'inequality checked by construction' },
      mistakes: a < 0 ? [{ answer: `x${ascii[op]}${x}`, type: 'no-flip', message: 'Almost! Dividing by a negative number reverses the inequality sign.' }] : [],
    };
  },
  'exponent-rules': (r) => {
    const a = ri(r, 2, 8), b = ri(r, 2, 6); const kind = ri(r, 0, 2);
    const forms: [string, number, string, number][] = [
      [`x${superscript(a)} · x${superscript(b)}`, a + b, 'Same base, multiplying → add the exponents.', a * b],
      [`(x${superscript(a)})${superscript(b)}`, a * b, 'Power of a power → multiply the exponents.', a + b],
      [`x${superscript(a + b)} ÷ x${superscript(b)}`, a, 'Same base, dividing → subtract the exponents.', (a + b) / b],
    ];
    const [show, p, rule, wrong] = forms[kind];
    return {
      prompt: `Simplify: ${show}   (answer like x^5)`, answerType: 'expression', answer: `x^${p}`, variable: 'x',
      hints: ['Write out what the exponents mean.', rule, 'Keep the same base x.'],
      steps: frame(`Simplify ${show}.`, rule, [`= x^${p}`], 'Test with x = 2 ✓'), explanation: `${show} = x^${p}. ${rule}`,
      verify: { kind: 'equivalent', expr: kind === 0 ? `x^${a}*x^${b}` : kind === 1 ? `(x^${a})^${b}` : `x^${a + b}/x^${b}`, vars: ['x'] },
      mistakes: [{ answer: `x^${wrong}`, type: 'wrong-rule', message: `Close — check which rule applies here. ${rule}` }],
    };
  },
  systems: (r) => {
    const x = nz(r, -6, 8), y = nz(r, -6, 8); const a1 = nz(r, -4, 5), b1 = nz(r, -4, 5); let a2 = nz(r, -4, 5), b2 = nz(r, -4, 5); while (a1 * b2 - a2 * b1 === 0) { a2 = nz(r, -4, 5); b2 = nz(r, -4, 5); }
    const c1 = a1 * x + b1 * y, c2 = a2 * x + b2 * y; const e1 = `${term(a1, 'x', true)}${term(b1, 'y')} = ${c1}`, e2 = `${term(a2, 'x', true)}${term(b2, 'y')} = ${c2}`;
    return {
      prompt: `Solve the system:\n${e1}\n${e2}\nAnswer as (x, y).`, answerType: 'pair', answer: `(${x}, ${y})`,
      hints: ['Can you make the coefficients of one variable match?', 'Elimination: multiply equations so one variable cancels when you add or subtract.', `Multiply the first by ${a2} and the second by ${a1}, then subtract.`],
      steps: frame('Find x and y that satisfy both equations.', 'Elimination.', [`Eliminate x: ${a2}·(1) − ${a1}·(2) gives ${a2 * b1 - a1 * b2}y = ${a2 * c1 - a1 * c2}`, `y = ${y}`, `Substitute: x = ${x}`], `Check eq.1: ${a1}(${x}) + ${b1}(${y}) = ${c1} ✓`),
      explanation: `(x, y) = (${x}, ${y}).`, verify: { kind: 'system', eqs: [`${a1}*x+${b1}*y=${c1}`, `${a2}*x+${b2}*y=${c2}`], vars: ['x', 'y'] },
      mistakes: [{ answer: `(${y}, ${x})`, type: 'swapped', message: 'Your values are swapped — remember the order (x, y).' }],
    };
  },
  'factor-quadratic': (r, d) => {
    const p = nz(r, -9, 9); let q = nz(r, -9, 9); if (q === p && d < 3) q = p + 1 || 2; const a = d >= 4 ? pick(r, [1, 2, 3]) : 1;
    const B = -a * (p + q), C = a * p * q; const show = poly([[a, 2], [B, 1], [C, 0]]).show;
    return {
      prompt: `Solve by factoring: ${show} = 0\n(If there are two solutions, separate them with a comma.)`, answerType: 'set', answer: [...new Set([p, q])].sort((u, v) => u - v).join(', '), variable: 'x',
      hints: [a > 1 ? `Factor out ${a} first.` : 'Find two numbers that multiply to the constant term and add to the x-coefficient.', `They must multiply to ${p * q} and add to ${p + q}.`, `(x ${sgn(-p)})(x ${sgn(-q)}) = 0.`],
      steps: frame(`Find the roots of ${show}.`, 'Factor, then use the zero product property.', [`${a > 1 ? `${a}` : ''}(x ${sgn(-p)})(x ${sgn(-q)}) = 0`, `x ${sgn(-p)} = 0 → x = ${p}`, `x ${sgn(-q)} = 0 → x = ${q}`], `Substitute x = ${p}: ${a * p * p + B * p + C} = 0 ✓`),
      explanation: `x = ${[...new Set([p, q])].join(' or x = ')}.`, verify: { kind: 'roots', expr: `${a}*x^2+${B}*x+${C}`, variable: 'x' },
      mistakes: [{ answer: [...new Set([-p, -q])].sort((u, v) => u - v).join(', '), type: 'sign-error', message: 'Check your signs: if (x − 3) = 0, then x = +3.' }],
    };
  },
  'quadratic-formula': (r, d) => {
    let a = pick(r, [1, 2, 3]), b = nz(r, -9, 9), c = nz(r, -9, 9); let disc = b * b - 4 * a * c;
    while (disc <= 0 || Number.isInteger(Math.sqrt(disc))) { b = nz(r, -9, 9); c = nz(r, -9, 9); a = pick(r, [1, 2, 3]); disc = b * b - 4 * a * c; }
    const show = poly([[a, 2], [b, 1], [c, 0]]).show;
    if (d <= 2) return {
      prompt: `For ${show} = 0, what is the discriminant b² − 4ac?`, answerType: 'number', answer: n(disc), hints: ['Identify a, b and c.', `a = ${a}, b = ${b}, c = ${c}.`, `${par(b)}² − 4(${a})(${par(c)}).`],
      steps: frame('Compute the discriminant.', 'Δ = b² − 4ac.', [`${b * b} − ${4 * a * c} = ${disc}`], `Δ > 0 → two real roots ✓`), explanation: `Δ = ${disc}, which is positive, so there are two real roots.`, verify: { kind: 'numeric', expr: `(${b})^2-4*(${a})*(${c})` },
      mistakes: [{ answer: n(-b * b - 4 * a * c), type: 'sign-of-b-squared', message: 'b² is always non-negative: (−b)² = b².' }],
    };
    const x1 = round((-b + Math.sqrt(disc)) / (2 * a), 2), x2 = round((-b - Math.sqrt(disc)) / (2 * a), 2);
    return {
      prompt: `Solve ${show} = 0 using the quadratic formula. Give both roots to 2 decimal places, separated by a comma.`, answerType: 'set', answer: [x2, x1].sort((u, v) => u - v).map(n).join(', '), tolerance: 0.011, variable: 'x',
      hints: ['Identify a, b and c.', 'x = (−b ± √(b² − 4ac)) / (2a).', `Δ = ${disc}.`],
      steps: frame(`Solve ${show} = 0.`, 'Quadratic formula.', [`a = ${a}, b = ${b}, c = ${c}`, `Δ = ${disc}`, `x = (${-b} ± √${disc}) / ${2 * a}`, `x ≈ ${n(x1)} or x ≈ ${n(x2)}`], 'Substituting gives approximately 0 ✓'),
      explanation: `x ≈ ${n(x1)} or ${n(x2)}.`, verify: { kind: 'roots', expr: `${a}*x^2+${b}*x+${c}`, variable: 'x' },
    };
  },
  logarithms: (r, d) => {
    const b = pick(r, [2, 3, 5, 10]); const p = ri(r, 2, b === 2 ? 7 : b === 10 ? 5 : 4);
    if (d >= 3 && r() < 0.5) {
      const p1 = ri(r, 1, 3), p2 = ri(r, 1, 3);
      return { prompt: `Evaluate log${subscript(b)}(${b ** p1} × ${b ** p2})`, answerType: 'number', answer: n(p1 + p2), hints: ['Use the product rule for logs.', 'log(ab) = log a + log b.', `log${subscript(b)} ${b ** p1} = ${p1}.`], steps: frame('Evaluate the log.', 'Product rule.', [`= log ${b ** p1} + log ${b ** p2} = ${p1} + ${p2} = ${p1 + p2}`], `${b}^${p1 + p2} = ${b ** (p1 + p2)} ✓`), explanation: `= ${p1 + p2}.`, verify: { kind: 'numeric', expr: `log(${b ** p1}*${b ** p2},${b})` } };
    }
    return { prompt: `Evaluate log${subscript(b)} ${b ** p}`, answerType: 'number', answer: n(p), hints: [`${b} to what power gives ${b ** p}?`, `log_b(x) = y means b^y = x.`, `${b}² = ${b * b}.`], steps: frame(`Evaluate log base ${b} of ${b ** p}.`, 'Rewrite as an exponent question.', [`${b}^${p} = ${b ** p}`], `log${subscript(b)} ${b ** p} = ${p} ✓`), explanation: `log${subscript(b)} ${b ** p} = ${p} because ${b}^${p} = ${b ** p}.`, verify: { kind: 'numeric', expr: `log(${b ** p},${b})` }, mistakes: [{ answer: n(b ** p / b), type: 'divided', message: 'A logarithm asks for the EXPONENT, not a quotient.' }] };
  },
  'complex-numbers': (r) => {
    const a = nz(r, -5, 5), b = nz(r, -5, 5), c = nz(r, -5, 5), e = nz(r, -5, 5); const mult = r() < 0.7;
    const re = mult ? a * c - b * e : a + c, im = mult ? a * e + b * c : b + e;
    const show = (x: number, y: number) => `${x} ${y < 0 ? '−' : '+'} ${Math.abs(y)}i`;
    return {
      prompt: `Simplify (${show(a, b)})${mult ? '' : ' +'}(${show(c, e)}). Answer in the form a + bi.`, answerType: 'expression', answer: `${re} ${im < 0 ? '-' : '+'} ${Math.abs(im)}i`,
      hints: [mult ? 'Expand like two binomials (FOIL).' : 'Add real parts and imaginary parts separately.', 'Remember i² = −1.', mult ? `The i² term is ${b * e}i² = ${-b * e}.` : `Real: ${a} + ${c}.`],
      steps: frame('Complex arithmetic.', mult ? 'FOIL then replace i² with −1.' : 'Combine like parts.', [`= ${re} ${im < 0 ? '−' : '+'} ${Math.abs(im)}i`], 'Real and imaginary parts collected ✓'),
      explanation: `= ${re} ${im < 0 ? '−' : '+'} ${Math.abs(im)}i.`, verify: { kind: 'equivalent', expr: mult ? `(${a}+${b}i)*(${c}+${e}i)` : `(${a}+${b}i)+(${c}+${e}i)`, vars: [] },
      mistakes: mult ? [{ answer: `${a * c + b * e} ${a * e + b * c < 0 ? '-' : '+'} ${Math.abs(a * e + b * c)}i`, type: 'i-squared', message: 'Remember i² = −1, so the i² term changes sign.' }] : [],
    };
  },

  // ───────────────────────── FUNCTIONS
  'coord-plane': (r, d) => {
    const x = nz(r, -8, 8), y = nz(r, -8, 8);
    if (d <= 2) {
      const q = x > 0 ? (y > 0 ? 'I' : 'IV') : y > 0 ? 'II' : 'III';
      return { prompt: `In which quadrant is the point (${x}, ${y})?`, answerType: 'choice', answer: q, choices: ['I', 'II', 'III', 'IV'], visual: { type: 'line-graph', m: 0, b: 0, points: [[x, y]] }, hints: ['Look at the signs of x and y.', 'Quadrants go I (+,+), II (−,+), III (−,−), IV (+,−) counter-clockwise.', `x is ${x > 0 ? 'positive' : 'negative'}, y is ${y > 0 ? 'positive' : 'negative'}.`], steps: frame('Locate the point.', 'Use the signs of the coordinates.', [`(${x > 0 ? '+' : '−'}, ${y > 0 ? '+' : '−'}) → Quadrant ${q}`], 'Matches the plotted point ✓'), explanation: `(${x}, ${y}) is in Quadrant ${q}.`, verify: { kind: 'choice' } };
    }
    const overX = r() < 0.5;
    return { prompt: `Reflect the point (${x}, ${y}) over the ${overX ? 'x' : 'y'}-axis. What are the new coordinates?`, answerType: 'pair', answer: overX ? `(${x}, ${-y})` : `(${-x}, ${y})`, hints: [`Which coordinate changes when you flip over the ${overX ? 'x' : 'y'}-axis?`, overX ? 'Reflecting over the x-axis changes the sign of y.' : 'Reflecting over the y-axis changes the sign of x.', 'The other coordinate stays the same.'], steps: frame('Reflect the point.', 'Flip the sign of one coordinate.', [overX ? `(${x}, ${-y})` : `(${-x}, ${y})`], 'Same distance from the axis on the other side ✓'), explanation: `The image is ${overX ? `(${x}, ${-y})` : `(${-x}, ${y})`}.`, verify: { kind: 'none', reason: 'by construction' } };
  },
  slope: (r) => {
    const x1 = ri(r, -6, 6), y1 = ri(r, -6, 6); let x2 = ri(r, -6, 6); while (x2 === x1) x2 = ri(r, -6, 6); const y2 = ri(r, -6, 6);
    return {
      prompt: `Find the slope of the line through (${x1}, ${y1}) and (${x2}, ${y2}).`, answerType: 'fraction', answer: frac(y2 - y1, x2 - x1), visual: { type: 'line-graph', m: (y2 - y1) / (x2 - x1), b: y1 - ((y2 - y1) / (x2 - x1)) * x1, points: [[x1, y1], [x2, y2]] },
      hints: ['Slope = rise ÷ run.', 'm = (y₂ − y₁) / (x₂ − x₁). Keep the same order on top and bottom.', `Rise: ${y2} − ${par(y1)} = ${y2 - y1}.`],
      steps: frame('Find the slope.', 'm = Δy/Δx.', [`Δy = ${y2 - y1}, Δx = ${x2 - x1}`, `m = ${y2 - y1}/${x2 - x1} = ${frac(y2 - y1, x2 - x1)}`], `The line ${y2 - y1 === 0 ? 'is horizontal' : (y2 - y1) / (x2 - x1) > 0 ? 'rises' : 'falls'} left to right ✓`),
      explanation: `m = ${frac(y2 - y1, x2 - x1)}.`, verify: { kind: 'numeric', expr: `(${y2}-${y1})/(${x2}-${x1})` },
      mistakes: y2 !== y1 ? [{ answer: frac(x2 - x1, y2 - y1), type: 'run-over-rise', message: 'Your fraction is upside down: slope is rise (change in y) over run (change in x).' }] : [],
    };
  },
  'slope-intercept': (r) => {
    const m = nz(r, -5, 5), b = ri(r, -9, 9), x1 = nz(r, -5, 5); const y1 = m * x1 + b;
    return {
      prompt: `A line has slope ${m} and passes through (${x1}, ${y1}). Write its equation in the form y = mx + b.`, answerType: 'expression', answer: `${m}x ${b < 0 ? '-' : '+'} ${Math.abs(b)}`, variable: 'x', visual: { type: 'line-graph', m, b, points: [[x1, y1]] },
      hints: ['You know m — you need b.', 'Substitute the point into y = mx + b and solve for b.', `${y1} = ${m}(${x1}) + b.`],
      steps: frame('Find the equation.', 'Use the point to solve for b.', [`${y1} = ${m * x1} + b`, `b = ${b}`, `y = ${m}x ${sgn(b)}`], `At x = ${x1}: ${m}(${x1}) ${sgn(b)} = ${y1} ✓`),
      explanation: `y = ${m}x ${sgn(b)}.`, verify: { kind: 'equivalent', expr: `${m}*x+${b}`, vars: ['x'] },
    };
  },
  'function-eval': (r, d) => {
    const a = nz(r, -3, 4), b = ri(r, -6, 6), c = ri(r, -9, 9), k = ri(r, -4, 5); const f = poly([[d >= 2 ? a : 0, 2], [b, 1], [c, 0]]);
    const val = (d >= 2 ? a * k * k : 0) + b * k + c;
    return {
      prompt: `If f(x) = ${f.show}, find f(${k}).`, answerType: 'number', answer: n(val),
      hints: [`Replace every x with (${k}).`, 'Use brackets around negative inputs, then follow the order of operations.', `Start with ${d >= 2 ? `${a}(${k})² = ${a * k * k}` : `${b}(${k}) = ${b * k}`}.`],
      steps: frame(`Evaluate f at ${k}.`, 'Substitute and simplify.', [`f(${k}) = ${val}`], 'Each term computed separately and added ✓'),
      explanation: `f(${k}) = ${val}.`, verify: { kind: 'numeric', expr: f.math.replaceAll('x', `(${k})`) },
      mistakes: k < 0 && d >= 2 ? [{ answer: n(-a * k * k + b * k + c), type: 'negative-squared', message: `Careful: (${k})² = ${k * k}, a positive number.` }] : [],
    };
  },
  composition: (r) => {
    const a = nz(r, -4, 4), b = ri(r, -6, 6), c = nz(r, -3, 3), e = ri(r, -5, 5), k = ri(r, -3, 4);
    const g = c * k + e; const val = a * g * g + b;
    return {
      prompt: `f(x) = ${term(a, 'x²', true)} ${sgn(b)} and g(x) = ${term(c, 'x', true)} ${sgn(e)}. Find f(g(${k})).`, answerType: 'number', answer: n(val),
      hints: ['Work from the inside out.', `First find g(${k}), then put that answer into f.`, `g(${k}) = ${g}.`],
      steps: frame('Evaluate the composition.', 'Inside function first.', [`g(${k}) = ${g}`, `f(${g}) = ${a}(${g})² ${sgn(b)} = ${val}`], 'Applied g first, then f ✓'),
      explanation: `f(g(${k})) = ${val}.`, verify: { kind: 'numeric', expr: `${a}*(${c}*${k}+${e})^2+${b}` },
      mistakes: [{ answer: n(c * (a * k * k + b) + e), type: 'wrong-order', message: `That is g(f(${k})). In f(g(x)), apply g FIRST.` }],
    };
  },
  'vertex-form': (r) => {
    const a = nz(r, -3, 3), h = ri(r, -5, 5), k = ri(r, -9, 9); const B = -2 * a * h, C = a * h * h + k;
    const show = poly([[a, 2], [B, 1], [C, 0]]).show;
    return {
      prompt: `Find the vertex of y = ${show}. Answer as (x, y).`, answerType: 'pair', answer: `(${h}, ${k})`, visual: { type: 'parabola', a, h, k },
      hints: ['The vertex x-coordinate is −b/(2a).', `Here a = ${a}, b = ${B}.`, `x = ${-B}/${2 * a} = ${h}. Now substitute to find y.`],
      steps: frame('Find the turning point.', 'x = −b/(2a), then substitute.', [`x = −(${B}) / (2·${a}) = ${h}`, `y = ${a}(${h})² ${sgn(B)}(${h}) ${sgn(C)} = ${k}`], `Vertex form: y = ${a}(x ${sgn(-h)})² ${sgn(k)} ✓`),
      explanation: `The vertex is (${h}, ${k}); it is a ${a > 0 ? 'minimum' : 'maximum'} because a ${a > 0 ? '> 0' : '< 0'}.`, verify: { kind: 'none', reason: 'by construction (completed square)' },
      mistakes: [{ answer: `(${-h}, ${k})`, type: 'sign-of-h', message: 'Check the sign of the x-coordinate: x = −b/(2a).' }],
    };
  },
  'exponential-growth': (r, d) => {
    if (d <= 2) { const P = ri(r, 2, 20) * 10, t = ri(r, 2, 6); return { prompt: `A population of ${P} bacteria doubles every hour. How many are there after ${t} hours?`, answerType: 'number', answer: n(P * 2 ** t), hints: ['Each hour multiplies by 2.', `A = P × 2^t.`, `${P} × 2^${t}.`], steps: frame('Doubling model.', 'A = P·2^t.', [`${P} × ${2 ** t} = ${P * 2 ** t}`], 'Grows quickly — exponential ✓'), explanation: `${P * 2 ** t} bacteria.`, verify: { kind: 'numeric', expr: `${P}*2^${t}` }, mistakes: [{ answer: n(P * 2 * t), type: 'linear', message: 'That treats growth as linear. Doubling multiplies by 2 EACH hour.' }] }; }
    const P = ri(r, 10, 90) * 100, rate = pick(r, [3, 5, 8, 10, 12]), t = ri(r, 2, 10), decay = r() < 0.4; const A = Math.round(P * (1 + (decay ? -rate : rate) / 100) ** t);
    return { prompt: `A town of ${P.toLocaleString('en-US')} people ${decay ? 'shrinks' : 'grows'} by ${rate}% per year. What is the population after ${t} years? (nearest whole number)`, answerType: 'number', answer: n(A), tolerance: 1.01, hints: [`Each year multiplies by ${decay ? `(1 − ${rate / 100})` : `(1 + ${rate / 100})`}.`, 'A = P(1 ± r)^t.', `Factor: ${1 + (decay ? -rate : rate) / 100}.`], steps: frame('Exponential model.', 'A = P(1 ± r)^t.', [`${P} × ${1 + (decay ? -rate : rate) / 100}^${t} ≈ ${A}`], 'Direction of change matches ✓'), explanation: `About ${A.toLocaleString('en-US')} people.`, verify: { kind: 'numeric', expr: `${P}*(1+${decay ? -rate : rate}/100)^${t}` } };
  },
  'arith-sequence': (r) => {
    const a1 = ri(r, -10, 20), dd = nz(r, -6, 8), k = ri(r, 10, 50);
    return {
      prompt: `An arithmetic sequence starts ${a1}, ${a1 + dd}, ${a1 + 2 * dd}, … What is the ${k}th term?`, answerType: 'number', answer: n(a1 + (k - 1) * dd),
      hints: ['Find the common difference.', 'aₙ = a₁ + (n − 1)d.', `d = ${dd}.`],
      steps: frame(`Find term ${k}.`, 'Use aₙ = a₁ + (n − 1)d.', [`a${k} = ${a1} + ${k - 1}(${dd}) = ${a1 + (k - 1) * dd}`], `Term 3 by formula: ${a1} + 2(${dd}) = ${a1 + 2 * dd} ✓`),
      explanation: `a${k} = ${a1 + (k - 1) * dd}.`, verify: { kind: 'numeric', expr: `${a1}+(${k}-1)*${dd}` },
      mistakes: [{ answer: n(a1 + k * dd), type: 'off-by-one', message: 'Close! From term 1 to term n there are (n − 1) steps.' }],
    };
  },
  'geom-series': (r, d) => {
    if (d <= 2) { const a = ri(r, 1, 5), m = ri(r, 2, 3), k = ri(r, 4, 7); return { prompt: `A geometric sequence starts ${a}, ${a * m}, ${a * m * m}, … What is the ${k}th term?`, answerType: 'number', answer: n(a * m ** (k - 1)), hints: ['Find the common ratio.', 'aₙ = a₁ · r^(n−1).', `r = ${m}.`], steps: frame(`Find term ${k}.`, 'aₙ = a₁rⁿ⁻¹.', [`${a} × ${m}^${k - 1} = ${a * m ** (k - 1)}`], '✓'), explanation: `= ${a * m ** (k - 1)}.`, verify: { kind: 'numeric', expr: `${a}*${m}^(${k}-1)` } }; }
    const a = ri(r, 1, 12), den = pick(r, [2, 3, 4, 5]), num = 1;
    return { prompt: `Find the sum of the infinite geometric series ${a} + ${frac(a * num, den)} + ${frac(a * num * num, den * den)} + …`, answerType: 'fraction', answer: frac(a * den, den - num), hints: ['What is the common ratio?', 'If |r| < 1, S∞ = a₁ / (1 − r).', `r = ${num}/${den}.`], steps: frame('Sum an infinite geometric series.', 'S = a/(1 − r).', [`r = ${num}/${den}`, `S = ${a} / (1 − ${num}/${den}) = ${frac(a * den, den - num)}`], 'Partial sums approach this value ✓'), explanation: `S = ${frac(a * den, den - num)}.`, verify: { kind: 'numeric', expr: `${a}/(1-${num}/${den})` } };
  },

  // ───────────────────────── GEOMETRY
  'k-shapes': (r) => {
    const shapes = [['circle', 0], ['triangle', 3], ['square', 4], ['rectangle', 4], ['pentagon', 5], ['hexagon', 6]] as const; const [s, sides] = pick(r, shapes);
    if (r() < 0.5 || s === 'circle') return { prompt: 'What shape is this?', answerType: 'choice', answer: s, choices: choices(r, s, shapes.map((x) => x[0]).filter((x) => x !== s).sort(() => r() - 0.5)), visual: { type: 'shape', shape: s }, hints: ['Count the sides.', 'Triangle = 3 sides, square = 4 equal sides, circle = no corners.', 'Look at the corners.'], steps: frame('Name the shape.', 'Count sides and corners.', [`It is a ${s}.`], '✓'), explanation: `This is a ${s}.`, verify: { kind: 'choice' } };
    return { prompt: `How many sides does a ${s} have?`, answerType: 'number', answer: n(sides), visual: { type: 'shape', shape: s }, hints: ['Count each straight edge.', 'Start at one corner and go around.', 'Each side connects two corners.'], steps: frame('Count sides.', 'Go around the shape.', [`${sides} sides.`], '✓'), explanation: `A ${s} has ${sides} sides.`, verify: { kind: 'numeric', expr: `${sides}` } };
  },
  'telling-time': (r, d) => {
    const h = ri(r, 1, 12); const m = d <= 1 ? 0 : d === 2 ? pick(r, [0, 30]) : d === 3 ? pick(r, [0, 15, 30, 45]) : ri(r, 0, 11) * 5; const ans = `${h}:${String(m).padStart(2, '0')}`;
    return { prompt: 'What time does the clock show? (e.g. 3:45)', answerType: 'text', answer: ans, accept: [`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`], visual: { type: 'clock', h, m }, hints: ['The short hand is the hour.', 'The long hand shows minutes: each number is 5 minutes.', `The long hand points at ${m === 0 ? 12 : m / 5}.`], steps: frame('Read the clock.', 'Hour hand, then minute hand.', [`Hour: ${h}`, `Minutes: ${m === 0 ? 12 : m / 5} × 5 = ${m}`], `${ans} ✓`), explanation: `It is ${ans}.`, verify: { kind: 'none', reason: 'by construction' } };
  },
  perimeter: (r, d) => {
    const l = ri(r, 3, 15 + d * 3), w = ri(r, 2, l);
    if (d >= 3 && r() < 0.5) return { prompt: `A rectangle has a perimeter of ${2 * (l + w)} cm and a length of ${l} cm. What is its width?`, answerType: 'number', unit: 'cm', answer: n(w), visual: { type: 'rect', w: l, h: w, unit: 'cm', labels: false }, hints: ['P = 2(l + w).', `Half the perimeter is l + w = ${l + w}.`, `${l + w} − ${l}.`], steps: frame('Find the missing width.', 'Rearrange P = 2(l + w).', [`l + w = ${2 * (l + w)} ÷ 2 = ${l + w}`, `w = ${l + w} − ${l} = ${w}`], `2(${l} + ${w}) = ${2 * (l + w)} ✓`), explanation: `The width is ${w} cm.`, verify: { kind: 'equation', eq: `2*(${l}+x)=${2 * (l + w)}`, variable: 'x' } };
    return { prompt: `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter?`, answerType: 'number', unit: 'cm', answer: n(2 * (l + w)), visual: { type: 'rect', w: l, h: w, unit: 'cm' }, hints: ['Perimeter is the distance all the way around.', 'Add all four sides: P = 2(l + w).', `${l} + ${w} + ${l} + ${w}.`], steps: frame('Find the distance around.', 'P = 2(l + w).', [`2(${l} + ${w}) = ${2 * (l + w)}`], `Perimeter is in cm (length units) ✓`), explanation: `P = ${2 * (l + w)} cm.`, verify: { kind: 'numeric', expr: `2*(${l}+${w})` }, mistakes: [{ answer: n(l * w), type: 'area-not-perimeter', message: 'That is the AREA (length × width). Perimeter is the distance around.' }, { answer: n(l + w), type: 'two-sides', message: 'That covers only two sides. A rectangle has four.' }] };
  },
  'area-rect': (r, d) => {
    const l = ri(r, 2, 6 + d * 3), w = ri(r, 2, 4 + d * 2);
    return { prompt: `A rectangle has a length of ${l} cm and a width of ${w} cm. What is its area?`, answerType: 'number', unit: 'cm²', answer: n(l * w), visual: { type: 'rect', w: l, h: w, unit: 'cm' }, hints: ['Area counts the unit squares inside.', 'A = length × width.', `${l} × ${w}.`], steps: frame('Find how many square units cover the rectangle.', 'A = l × w.', [`A = ${l} × ${w} = ${l * w}`], 'Units are square centimeters (cm²) ✓'), explanation: `The rectangle has a length of ${l} cm and a width of ${w} cm. Using A = length × width, ${l} × ${w} = ${l * w}, so the area is ${l * w} cm².`, verify: { kind: 'numeric', expr: `${l}*${w}` }, mistakes: [{ answer: n(2 * (l + w)), type: 'perimeter-not-area', message: 'That is the PERIMETER (distance around). Area is length × width.' }] };
  },
  'area-triangle': (r, d) => {
    const b = ri(r, 2, 10 + d * 3) * 2, h = ri(r, 2, 8 + d * 2); const para = d >= 3 && r() < 0.4;
    return { prompt: `A ${para ? 'parallelogram' : 'triangle'} has base ${b} m and height ${h} m. What is its area?`, answerType: 'number', unit: 'm²', answer: n(para ? b * h : (b * h) / 2), visual: para ? undefined : { type: 'right-triangle', a: h, b, c: '', unit: 'm' }, hints: [para ? 'A parallelogram rearranges into a rectangle.' : 'A triangle is half of a rectangle.', para ? 'A = b × h.' : 'A = ½ × base × height.', `${b} × ${h} = ${b * h}.`], steps: frame('Find the area.', para ? 'A = bh.' : 'A = ½bh.', [para ? `${b} × ${h} = ${b * h}` : `½ × ${b} × ${h} = ${(b * h) / 2}`], 'Square units ✓'), explanation: `A = ${para ? b * h : (b * h) / 2} m².`, verify: { kind: 'numeric', expr: para ? `${b}*${h}` : `${b}*${h}/2` }, mistakes: para ? [] : [{ answer: n(b * h), type: 'forgot-half', message: 'That is the area of the rectangle around it. A triangle is HALF of that.' }] };
  },
  angles: (r, d) => {
    const kind = ri(r, 0, d >= 3 ? 2 : 1);
    if (kind === 0) { const a = ri(r, 20, 100), b = ri(r, 20, 160 - a - 10); return { prompt: `Two angles of a triangle are ${a}° and ${b}°. What is the third angle?`, answerType: 'number', unit: '°', answer: n(180 - a - b), hints: ['What do the angles in a triangle add up to?', 'Angles in a triangle sum to 180°.', `180 − ${a} − ${b}.`], steps: frame('Find the missing angle.', 'Use the 180° angle sum.', [`180 − ${a} − ${b} = ${180 - a - b}`], `${a} + ${b} + ${180 - a - b} = 180 ✓`), explanation: `The third angle is ${180 - a - b}°.`, verify: { kind: 'numeric', expr: `180-${a}-${b}` }, mistakes: [{ answer: n(360 - a - b), type: 'used-360', message: 'Triangle angles sum to 180°, not 360°.' }] }; }
    if (kind === 1) { const a = ri(r, 15, 165); return { prompt: `Two angles sit on a straight line. One is ${a}°. What is the other?`, answerType: 'number', unit: '°', answer: n(180 - a), hints: ['A straight line is a half turn.', 'Angles on a straight line add to 180°.', `180 − ${a}.`], steps: frame('Supplementary angles.', 'They sum to 180°.', [`180 − ${a} = ${180 - a}`], '✓'), explanation: `${180 - a}°.`, verify: { kind: 'numeric', expr: `180-${a}` } }; }
    const apex = ri(r, 10, 80) * 2; return { prompt: `An isosceles triangle has a top (apex) angle of ${apex}°. What is each base angle?`, answerType: 'number', unit: '°', answer: n((180 - apex) / 2), hints: ['The two base angles are equal.', 'Subtract the apex from 180°, then split equally.', `180 − ${apex} = ${180 - apex}.`], steps: frame('Isosceles triangle.', 'Equal base angles share what is left.', [`(180 − ${apex}) ÷ 2 = ${(180 - apex) / 2}`], `${apex} + 2(${(180 - apex) / 2}) = 180 ✓`), explanation: `${(180 - apex) / 2}° each.`, verify: { kind: 'numeric', expr: `(180-${apex})/2` } };
  },
  circles: (r, d) => {
    const rad = ri(r, 2, 6 + d * 3); const area = r() < 0.5; const val = round(area ? Math.PI * rad * rad : 2 * Math.PI * rad, 2);
    return { prompt: `A circle has radius ${rad} cm. What is its ${area ? 'area' : 'circumference'}? (2 decimal places, use π)`, answerType: 'number', unit: area ? 'cm²' : 'cm', answer: n(val), tolerance: Math.max(0.02, val * 0.002), visual: { type: 'circle', r: rad, unit: 'cm' }, hints: [area ? 'Area uses r squared.' : 'Circumference is the distance around.', area ? 'A = πr².' : 'C = 2πr.', area ? `π × ${rad}² = π × ${rad * rad}.` : `2 × π × ${rad}.`], steps: frame(`Find the ${area ? 'area' : 'circumference'}.`, area ? 'A = πr².' : 'C = 2πr.', [area ? `π × ${rad * rad} ≈ ${val}` : `2π × ${rad} ≈ ${val}`], area ? 'Units cm² ✓' : 'Units cm ✓'), explanation: `${area ? 'A' : 'C'} ≈ ${val} ${area ? 'cm²' : 'cm'}.`, verify: { kind: 'numeric', expr: area ? `pi*${rad}^2` : `2*pi*${rad}` }, mistakes: [{ answer: n(round(area ? 2 * Math.PI * rad : Math.PI * rad * rad, 2)), type: 'mixed-formula', message: area ? 'That is the circumference. Area uses πr².' : 'That is the area. Circumference uses 2πr.' }] };
  },
  volume: (r, d) => {
    if (d <= 2 || r() < 0.5) { const l = ri(r, 2, 12), w = ri(r, 2, 10), h = ri(r, 2, 10); return { prompt: `A box is ${l} cm × ${w} cm × ${h} cm. What is its volume?`, answerType: 'number', unit: 'cm³', answer: n(l * w * h), hints: ['Volume = base area × height.', 'For a box: V = l × w × h.', `Base area: ${l} × ${w} = ${l * w}.`], steps: frame('Find the space inside.', 'V = lwh.', [`${l} × ${w} × ${h} = ${l * w * h}`], 'Cubic units ✓'), explanation: `V = ${l * w * h} cm³.`, verify: { kind: 'numeric', expr: `${l}*${w}*${h}` } }; }
    const rad = ri(r, 1, 8), h = ri(r, 2, 15); const v = round(Math.PI * rad * rad * h, 2);
    return { prompt: `A cylinder has radius ${rad} cm and height ${h} cm. What is its volume? (2 decimal places)`, answerType: 'number', unit: 'cm³', answer: n(v), tolerance: Math.max(0.02, v * 0.002), hints: ['Volume = base area × height.', 'The base is a circle: πr².', `π × ${rad}² × ${h}.`], steps: frame('Cylinder volume.', 'V = πr²h.', [`π × ${rad * rad} × ${h} ≈ ${v}`], 'Cubic units ✓'), explanation: `V ≈ ${v} cm³.`, verify: { kind: 'numeric', expr: `pi*${rad}^2*${h}` } };
  },
  pythagorean: (r, d) => {
    const triples = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15], [20, 21, 29]]; const [a0, b0, c0] = pick(r, triples); const k = d <= 2 ? 1 : ri(r, 1, 3); const [a, b, c] = [a0 * k, b0 * k, c0 * k];
    if (d >= 4 && r() < 0.5) { const p = ri(r, 2, 12), q = ri(r, 2, 12); const hyp = round(Math.sqrt(p * p + q * q), 2); return { prompt: `A right triangle has legs ${p} and ${q}. Find the hypotenuse to 2 decimal places.`, answerType: 'number', answer: n(hyp), tolerance: 0.011, visual: { type: 'right-triangle', a: p, b: q, c: '?' }, hints: ['Use a² + b² = c².', `${p}² + ${q}² = ${p * p + q * q}.`, `c = √${p * p + q * q}.`], steps: frame('Find the hypotenuse.', 'Pythagorean theorem.', [`c² = ${p * p} + ${q * q} = ${p * p + q * q}`, `c ≈ ${hyp}`], 'Longest side ✓'), explanation: `c ≈ ${hyp}.`, verify: { kind: 'numeric', expr: `sqrt(${p}^2+${q}^2)` } }; }
    const findLeg = d >= 3 && r() < 0.5;
    if (findLeg) return { prompt: `A right triangle has hypotenuse ${c} and one leg ${a}. How long is the other leg?`, answerType: 'number', answer: n(b), visual: { type: 'right-triangle', a, b: '?', c }, hints: ['The hypotenuse is c.', 'b² = c² − a².', `${c}² − ${a}² = ${c * c - a * a}.`], steps: frame('Find a missing leg.', 'Rearrange a² + b² = c².', [`b² = ${c * c} − ${a * a} = ${c * c - a * a}`, `b = ${b}`], `${a}² + ${b}² = ${c}² ✓`), explanation: `The other leg is ${b}.`, verify: { kind: 'numeric', expr: `sqrt(${c}^2-${a}^2)` }, mistakes: [{ answer: n(round(Math.sqrt(c * c + a * a), 2)), type: 'added-squares', message: 'When finding a leg, SUBTRACT: b² = c² − a².' }] };
    return { prompt: `A right triangle has legs of length ${a} and ${b}. How long is the hypotenuse?`, answerType: 'number', answer: n(c), visual: { type: 'right-triangle', a, b, c: '?' }, hints: ['Which side is the hypotenuse?', 'a² + b² = c².', `${a}² + ${b}² = ${a * a + b * b}.`], steps: frame('Find the hypotenuse.', 'Pythagorean theorem.', [`c² = ${a * a} + ${b * b} = ${c * c}`, `c = √${c * c} = ${c}`], `${c} is longer than both legs ✓`), explanation: `The hypotenuse is ${c}, since ${a}² + ${b}² = ${c}².`, verify: { kind: 'numeric', expr: `sqrt(${a}^2+${b}^2)` }, mistakes: [{ answer: n(a + b), type: 'added-sides', message: 'The sides don’t simply add — square them first: a² + b² = c².' }] };
  },
  'distance-midpoint': (r) => {
    const [a, b] = pick(r, [[3, 4], [5, 12], [6, 8], [8, 15]]); const x1 = ri(r, -6, 6), y1 = ri(r, -6, 6); const x2 = x1 + a * (r() < 0.5 ? 1 : -1), y2 = y1 + b * (r() < 0.5 ? 1 : -1);
    if (r() < 0.5) return { prompt: `Find the distance between (${x1}, ${y1}) and (${x2}, ${y2}).`, answerType: 'number', answer: n(Math.hypot(a, b)), hints: ['Make a right triangle.', 'd = √((x₂−x₁)² + (y₂−y₁)²).', `Δx = ${x2 - x1}, Δy = ${y2 - y1}.`], steps: frame('Distance formula.', 'Pythagoras on the grid.', [`d = √(${(x2 - x1) ** 2} + ${(y2 - y1) ** 2}) = ${Math.hypot(a, b)}`], '✓'), explanation: `d = ${Math.hypot(a, b)}.`, verify: { kind: 'numeric', expr: `sqrt((${x2}-${x1})^2+(${y2}-${y1})^2)` } };
    return { prompt: `Find the midpoint of (${x1}, ${y1}) and (${x2}, ${y2}). Answer as (x, y).`, answerType: 'pair', answer: `(${n((x1 + x2) / 2)}, ${n((y1 + y2) / 2)})`, hints: ['Average the coordinates.', 'M = ((x₁ + x₂)/2, (y₁ + y₂)/2).', `x: (${x1} + ${x2}) ÷ 2.`], steps: frame('Midpoint.', 'Average x’s and y’s.', [`(${n((x1 + x2) / 2)}, ${n((y1 + y2) / 2)})`], 'Halfway between the points ✓'), explanation: `M = (${n((x1 + x2) / 2)}, ${n((y1 + y2) / 2)}).`, verify: { kind: 'none', reason: 'by construction' } };
  },
  vectors: (r, d) => {
    const a = nz(r, -6, 6), b = nz(r, -6, 6), c = nz(r, -6, 6), e = nz(r, -6, 6); const kind = ri(r, 0, d >= 3 ? 2 : 1);
    if (kind === 0) return { prompt: `u = ⟨${a}, ${b}⟩, v = ⟨${c}, ${e}⟩. Find u + v. Answer as (x, y).`, answerType: 'pair', answer: `(${a + c}, ${b + e})`, hints: ['Add component by component.', '⟨a, b⟩ + ⟨c, d⟩ = ⟨a + c, b + d⟩.', `x: ${a} + ${par(c)}.`], steps: frame('Vector addition.', 'Componentwise.', [`⟨${a + c}, ${b + e}⟩`], 'Tip-to-tail ✓'), explanation: `u + v = ⟨${a + c}, ${b + e}⟩.`, verify: { kind: 'none', reason: 'by construction' } };
    if (kind === 1) { const [p, q] = pick(r, [[3, 4], [5, 12], [6, 8], [8, 15], [7, 24]]); return { prompt: `Find the magnitude of the vector ⟨${p}, ${-q}⟩.`, answerType: 'number', answer: n(Math.hypot(p, q)), hints: ['Magnitude is length.', '|⟨a, b⟩| = √(a² + b²).', `${p}² + ${q}² = ${p * p + q * q}.`], steps: frame('Vector length.', 'Pythagoras.', [`√${p * p + q * q} = ${Math.hypot(p, q)}`], 'Non-negative ✓'), explanation: `|v| = ${Math.hypot(p, q)}.`, verify: { kind: 'numeric', expr: `sqrt(${p}^2+${q}^2)` } }; }
    return { prompt: `Compute the dot product ⟨${a}, ${b}⟩ · ⟨${c}, ${e}⟩.`, answerType: 'number', answer: n(a * c + b * e), hints: ['Multiply matching components.', 'u·v = u₁v₁ + u₂v₂.', `${a}·${par(c)} = ${a * c}.`], steps: frame('Dot product.', 'Sum of products.', [`${a * c} + ${b * e} = ${a * c + b * e}`], a * c + b * e === 0 ? 'Zero → perpendicular ✓' : '✓'), explanation: `u·v = ${a * c + b * e}.`, verify: { kind: 'numeric', expr: `${a}*${c}+${b}*${e}` } };
  },

  // ───────────────────────── STATISTICS
  'bar-graphs': (r) => {
    const labels = pick(r, [['Apples', 'Bananas', 'Grapes', 'Pears'], ['Soccer', 'Hockey', 'Tennis', 'Swim'], ['Mon', 'Tue', 'Wed', 'Thu']]); const values = labels.map(() => ri(r, 2, 20));
    const i = ri(r, 0, 3); let j = ri(r, 0, 3); while (j === i || values[j] === values[i]) { j = ri(r, 0, 3); if (values.every((v) => v === values[0])) values[1]++; }
    const [hi, lo] = values[i] > values[j] ? [i, j] : [j, i];
    return { prompt: `How many more votes did ${labels[hi]} get than ${labels[lo]}?`, answerType: 'number', answer: n(values[hi] - values[lo]), visual: { type: 'bar-chart', labels, values }, hints: ['Read the value at the top of each bar.', '"How many more" means subtract.', `${labels[hi]}: ${values[hi]}.`], steps: frame('Compare two bars.', 'Read values and subtract.', [`${values[hi]} − ${values[lo]} = ${values[hi] - values[lo]}`], '✓'), explanation: `${values[hi] - values[lo]} more.`, verify: { kind: 'numeric', expr: `${values[hi]}-${values[lo]}` } };
  },
  'mean-median-mode': (r, d) => {
    const cnt = pick(r, [5, 6, 7]); const data = Array.from({ length: cnt }, () => ri(r, 1, 20 + d * 5)); const kind = ri(r, 0, 3);
    const sorted = [...data].sort((a, b) => a - b);
    if (kind === 0) { const target = ri(r, 3, 15); data[cnt - 1] += target * cnt - data.reduce((s, v) => s + v, 0); if (data[cnt - 1] < 0) data[cnt - 1] = Math.abs(data[cnt - 1]); }
    const sum = data.reduce((s, v) => s + v, 0); const mean = round(sum / cnt, 2); sorted.splice(0, sorted.length, ...[...data].sort((a, b) => a - b));
    const median = cnt % 2 ? sorted[(cnt - 1) / 2] : (sorted[cnt / 2 - 1] + sorted[cnt / 2]) / 2; const range = sorted[cnt - 1] - sorted[0];
    const ask = (['mean', 'median', 'range', 'median'] as const)[kind]; const ans = ask === 'mean' ? mean : ask === 'median' ? median : range;
    return { prompt: `Find the ${ask} of: ${data.join(', ')}${ask === 'mean' ? ' (2 decimal places if needed)' : ''}`, answerType: 'number', answer: n(ans), tolerance: ask === 'mean' ? 0.011 : undefined, hints: [ask === 'mean' ? 'Add them all up.' : 'Put the numbers in order first.', ask === 'mean' ? 'Mean = sum ÷ count.' : ask === 'median' ? 'The median is the middle value (average the two middle values if the count is even).' : 'Range = largest − smallest.', `Sorted: ${sorted.join(', ')}.`], steps: frame(`Find the ${ask}.`, ask === 'mean' ? 'Sum ÷ count.' : 'Sort first.', [ask === 'mean' ? `${sum} ÷ ${cnt} = ${n(mean)}` : ask === 'median' ? `Middle of ${sorted.join(', ')} → ${n(median)}` : `${sorted[cnt - 1]} − ${sorted[0]} = ${range}`], '✓'), explanation: `The ${ask} is ${n(ans)}.`, verify: { kind: 'numeric', expr: ask === 'mean' ? `mean([${data.join(',')}])` : ask === 'median' ? `median([${data.join(',')}])` : `max([${data.join(',')}])-min([${data.join(',')}])` }, mistakes: ask === 'median' ? [{ answer: n(cnt % 2 ? data[(cnt - 1) / 2] : (data[cnt / 2 - 1] + data[cnt / 2]) / 2), type: 'unsorted-median', message: 'Remember to sort the data before finding the middle value.' }] : [] };
  },
  'std-dev': (r) => {
    const mu = ri(r, 5, 20); const devs = pick(r, [[-2, 2, -1, 1], [-3, 3, 0, 0, -1, 1], [-4, 4, -2, 2], [-1, 1, -5, 5]]); const data = devs.map((x) => mu + x);
    const sd = round(Math.sqrt(devs.reduce((s, v) => s + v * v, 0) / data.length), 2);
    return { prompt: `Find the population standard deviation of: ${data.join(', ')} (2 decimal places)`, answerType: 'number', answer: n(sd), tolerance: 0.011, hints: ['Find the mean first.', 'Average the squared distances from the mean, then take the square root.', `Mean = ${mu}.`], steps: frame('Measure spread.', 'σ = √(Σ(x − μ)²/n).', [`μ = ${mu}`, `Squared deviations: ${devs.map((x) => x * x).join(', ')}`, `Variance = ${n(devs.reduce((s, v) => s + v * v, 0) / data.length)}`, `σ ≈ ${sd}`], 'σ is smaller than the range ✓'), explanation: `σ ≈ ${sd}.`, verify: { kind: 'numeric', expr: `std([${data.join(',')}], "uncorrected")` } };
  },
  'z-scores': (r) => {
    const mu = ri(r, 50, 80), sd = pick(r, [4, 5, 8, 10]), z = pick(r, [-2, -1.5, -1, 0.5, 1, 1.5, 2, 2.5]); const x = mu + z * sd;
    return { prompt: `Test scores have mean ${mu} and standard deviation ${sd}. What is the z-score of a score of ${n(x)}?`, answerType: 'number', answer: n(z), hints: ['How far is the score from the mean?', 'z = (x − μ) / σ.', `${n(x)} − ${mu} = ${n(x - mu)}.`], steps: frame('Standardize.', 'z = (x − μ)/σ.', [`(${n(x)} − ${mu}) / ${sd} = ${z}`], `${z > 0 ? 'Above' : 'Below'} the mean ✓`), explanation: `z = ${z}.`, verify: { kind: 'numeric', expr: `(${x}-${mu})/${sd}` } };
  },

  // ───────────────────────── PROBABILITY
  'simple-prob': (r, d) => {
    if (r() < 0.5) { const red = ri(r, 1, 8), blue = ri(r, 1, 8), green = ri(r, 0, 6); const tot = red + blue + green; const col = pick(r, ['red', 'blue']); const fav = col === 'red' ? red : blue; return { prompt: `A bag has ${red} red, ${blue} blue${green ? ` and ${green} green` : ''} marbles. You pick one at random. What is P(${col})?`, answerType: 'fraction', answer: frac(fav, tot), hints: ['How many marbles in total?', 'P = favorable outcomes ÷ total outcomes.', `Total = ${tot}.`], steps: frame('Find the probability.', 'Favorable ÷ total.', [`${fav}/${tot} = ${frac(fav, tot)}`], 'Between 0 and 1 ✓'), explanation: `P(${col}) = ${frac(fav, tot)}.`, verify: { kind: 'numeric', expr: `${fav}/${tot}` }, mistakes: [{ answer: frac(fav, tot - fav), type: 'odds-not-probability', message: 'You compared to the OTHER marbles. Probability compares to ALL marbles.' }] }; }
    const evs: [string, number][] = [['an even number', 3], ['a number greater than 4', 2], ['a 6', 1], ['a prime number', 3], ['a multiple of 3', 2]]; const [ev, fav] = pick(r, evs);
    return { prompt: `You roll a fair six-sided die. What is the probability of rolling ${ev}?`, answerType: 'fraction', answer: frac(fav, 6), visual: d <= 2 ? { type: 'dice', values: [1, 2, 3, 4, 5, 6] } : undefined, hints: ['List all possible outcomes: 1–6.', 'Count the outcomes that match.', `There are ${fav} favorable outcomes.`], steps: frame('Probability on a die.', 'Favorable ÷ 6.', [`${fav}/6 = ${frac(fav, 6)}`], '✓'), explanation: `P = ${frac(fav, 6)}.`, verify: { kind: 'numeric', expr: `${fav}/6` } };
  },
  'compound-prob': (r) => {
    const kind = ri(r, 0, 2);
    if (kind === 0) { const k = ri(r, 2, 4); return { prompt: `You flip a fair coin ${k} times. What is the probability that all ${k} flips are heads?`, answerType: 'fraction', answer: frac(1, 2 ** k), hints: ['Each flip is independent.', 'For independent events, multiply probabilities.', `(1/2) × (1/2) …`], steps: frame('Independent events.', 'Multiply.', [`(1/2)^${k} = 1/${2 ** k}`], '✓'), explanation: `P = 1/${2 ** k}.`, verify: { kind: 'numeric', expr: `(1/2)^${k}` } }; }
    if (kind === 1) { const fav = ri(r, 1, 5); return { prompt: `You flip a coin and roll a die. What is P(heads AND a number less than ${fav + 1})?`, answerType: 'fraction', answer: frac(fav, 12), hints: ['These are independent.', 'P(A and B) = P(A) × P(B).', `P(die < ${fav + 1}) = ${fav}/6.`], steps: frame('Independent "and".', 'Multiply.', [`1/2 × ${fav}/6 = ${frac(fav, 12)}`], '✓'), explanation: `P = ${frac(fav, 12)}.`, verify: { kind: 'numeric', expr: `1/2*${fav}/6` }, mistakes: [{ answer: frac(3 + fav, 6), type: 'added', message: 'For "and" with independent events, multiply — don’t add.' }] }; }
    const red = ri(r, 2, 6), blue = ri(r, 2, 6); const tot = red + blue;
    return { prompt: `A bag has ${red} red and ${blue} blue counters. You draw two WITHOUT replacement. What is P(both red)?`, answerType: 'fraction', answer: frac(red * (red - 1), tot * (tot - 1)), hints: ['The second draw depends on the first.', 'After one red is removed, there is one fewer red and one fewer total.', `P = ${red}/${tot} × ${red - 1}/${tot - 1}.`], steps: frame('Dependent events.', 'Multiply conditional probabilities.', [`${red}/${tot} × ${red - 1}/${tot - 1} = ${frac(red * (red - 1), tot * (tot - 1))}`], '✓'), explanation: `P = ${frac(red * (red - 1), tot * (tot - 1))}.`, verify: { kind: 'numeric', expr: `${red}/${tot}*${red - 1}/${tot - 1}` }, mistakes: [{ answer: frac(red * red, tot * tot), type: 'with-replacement', message: 'That assumes the first counter is put back. Without replacement, the numbers change.' }] };
  },
  counting: (r, d) => {
    const nn = ri(r, 5, d >= 3 ? 12 : 8), k = ri(r, 2, Math.min(4, nn - 1)); const perm = r() < 0.5;
    const ans = perm ? fact(nn) / fact(nn - k) : nCr(nn, k);
    return { prompt: perm ? `In how many ways can ${k} different prizes (1st, 2nd${k > 2 ? ', …' : ''}) be awarded among ${nn} people?` : `How many ways can you choose ${k} people from ${nn} for a team (order doesn't matter)?`, answerType: 'number', answer: n(ans), hints: ['Does order matter here?', perm ? 'Order matters → permutations: n!/(n − k)!.' : 'Order doesn’t matter → combinations: n!/(k!(n − k)!).', perm ? `${nn} × ${nn - 1} × …` : `C(${nn}, ${k}).`], steps: frame('Count the outcomes.', perm ? 'Permutation.' : 'Combination.', [perm ? `${Array.from({ length: k }, (_, i) => nn - i).join(' × ')} = ${ans}` : `${nn}! / (${k}! · ${nn - k}!) = ${ans}`], '✓'), explanation: `${ans} ways.`, verify: { kind: 'numeric', expr: perm ? `permutations(${nn},${k})` : `combinations(${nn},${k})` }, mistakes: [{ answer: n(perm ? nCr(nn, k) : fact(nn) / fact(nn - k)), type: perm ? 'used-combination' : 'used-permutation', message: perm ? 'Here order matters (1st vs 2nd prize), so use permutations.' : 'Order doesn’t matter for a team, so divide out the arrangements.' }] };
  },
  binomial: (r) => {
    const nn = ri(r, 3, 6), k = ri(r, 1, nn - 1);
    return { prompt: `A fair coin is flipped ${nn} times. What is the probability of exactly ${k} heads?`, answerType: 'fraction', answer: frac(nCr(nn, k), 2 ** nn), hints: ['How many ways can the heads be arranged?', 'P(X = k) = C(n, k) · pᵏ(1 − p)ⁿ⁻ᵏ.', `C(${nn}, ${k}) = ${nCr(nn, k)}.`], steps: frame('Binomial probability.', 'C(n,k)·pᵏ(1−p)ⁿ⁻ᵏ.', [`${nCr(nn, k)} × (1/2)^${nn} = ${frac(nCr(nn, k), 2 ** nn)}`], '✓'), explanation: `P = ${frac(nCr(nn, k), 2 ** nn)}.`, verify: { kind: 'numeric', expr: `combinations(${nn},${k})*(1/2)^${nn}` }, mistakes: [{ answer: frac(1, 2 ** nn), type: 'forgot-arrangements', message: 'That is the chance of ONE particular sequence. Multiply by the number of arrangements C(n, k).' }] };
  },
  'expected-value': (r) => {
    const win = ri(r, 2, 20) * 5, p = pick(r, [[1, 4], [1, 5], [1, 10], [3, 10], [1, 2]]), cost = ri(r, 1, 10);
    const ev = round((win * p[0]) / p[1] - cost, 2);
    return { prompt: `A game costs $${cost} to play. You win $${win} with probability ${p[0]}/${p[1]}, otherwise nothing. What is the expected value of playing (in $)?`, answerType: 'number', unit: '$', answer: n(ev), hints: ['Expected value = Σ value × probability.', `Expected winnings = ${win} × ${p[0]}/${p[1]}. Then subtract the cost.`, `${win} × ${p[0]}/${p[1]} = ${n((win * p[0]) / p[1])}.`], steps: frame('Expected value.', 'Weighted average of outcomes.', [`E = ${win}·${p[0]}/${p[1]} − ${cost} = ${n(ev)}`], ev < 0 ? 'Negative → you lose money on average ✓' : 'Positive → favorable on average ✓'), explanation: `E = $${n(ev)} per game.`, verify: { kind: 'numeric', expr: `${win}*${p[0]}/${p[1]}-${cost}` } };
  },

  // ───────────────────────── TRIGONOMETRY
  'trig-ratios': (r, d) => {
    if (d <= 2) { const [a, b, c] = pick(r, [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25]]); const fn = pick(r, ['sin', 'cos', 'tan'] as const); const ans = fn === 'sin' ? frac(a, c) : fn === 'cos' ? frac(b, c) : frac(a, b); return { prompt: `In a right triangle, the side opposite angle θ is ${a}, the adjacent side is ${b} and the hypotenuse is ${c}. What is ${fn} θ?`, answerType: 'fraction', answer: ans, visual: { type: 'right-triangle', a, b, c }, hints: ['Remember SOH-CAH-TOA.', fn === 'sin' ? 'sin = opposite/hypotenuse' : fn === 'cos' ? 'cos = adjacent/hypotenuse' : 'tan = opposite/adjacent', 'Identify the two sides you need.'], steps: frame(`Find ${fn} θ.`, 'SOH CAH TOA.', [`${fn} θ = ${ans}`], 'Value between 0 and 1 for sin/cos ✓'), explanation: `${fn} θ = ${ans}.`, verify: { kind: 'numeric', expr: fn === 'sin' ? `${a}/${c}` : fn === 'cos' ? `${b}/${c}` : `${a}/${b}` } }; }
    const ang = ri(r, 15, 75), hyp = ri(r, 5, 30); const opp = round(hyp * Math.sin((ang * Math.PI) / 180), 2);
    return { prompt: `A ladder ${hyp} m long leans against a wall, making a ${ang}° angle with the ground. How high up the wall does it reach? (2 decimal places)`, answerType: 'number', unit: 'm', answer: n(opp), tolerance: 0.011, hints: ['Draw the right triangle: the ladder is the hypotenuse.', 'The height is opposite the angle → use sine.', `h = ${hyp} × sin ${ang}°.`], steps: frame('Find the height.', 'sin θ = opposite/hypotenuse.', [`h = ${hyp} sin ${ang}° ≈ ${opp}`], `h < ${hyp} ✓`), explanation: `The ladder reaches about ${opp} m.`, verify: { kind: 'numeric', expr: `${hyp}*sin(${ang} deg)` }, mistakes: [{ answer: n(round(hyp * Math.cos((ang * Math.PI) / 180), 2)), type: 'used-cos', message: 'That is the adjacent side (the base). The height is OPPOSITE the angle — use sine.' }] };
  },
  'unit-circle': (r, d) => {
    if (d <= 2) { const deg = pick(r, [30, 45, 60, 90, 120, 135, 150, 180, 270]); const g = gcd(deg, 180); const show = `${deg / g === 1 ? '' : deg / g}π${180 / g === 1 ? '' : `/${180 / g}`}`; return { prompt: `Convert ${deg}° to radians. (Type like pi/3 or 3pi/4)`, answerType: 'expression', answer: show.replace('π', 'pi'), hints: ['π radians = 180°.', 'Multiply by π/180.', `${deg} × π/180.`], steps: frame('Degrees → radians.', '× π/180.', [`${deg}π/180 = ${show}`], '✓'), explanation: `${deg}° = ${show}.`, verify: { kind: 'equivalent', expr: `${deg}*pi/180`, vars: [] } }; }
    const table: [string, string, string[]][] = [['sin 30°', '1/2', ['√3/2', '√2/2', '1']], ['cos 60°', '1/2', ['√3/2', '0', '√2/2']], ['sin 60°', '√3/2', ['1/2', '√2/2', '√3']], ['cos 45°', '√2/2', ['1/2', '√3/2', '1']], ['tan 45°', '1', ['0', '√3', '1/2']], ['cos 180°', '−1', ['0', '1', '1/2']], ['sin 270°', '−1', ['1', '0', '−1/2']], ['cos 120°', '−1/2', ['1/2', '√3/2', '−√3/2']], ['sin 150°', '1/2', ['−1/2', '√3/2', '−√3/2']], ['tan 60°', '√3', ['1/√3', '1', '√3/2']]];
    const [q, a, ds] = pick(r, table);
    return { prompt: `What is the exact value of ${q}?`, answerType: 'choice', answer: a, choices: choices(r, a, ds), visual: { type: 'unit-circle', angle: Number(q.match(/\d+/)![0]) }, hints: ['Picture the angle on the unit circle.', 'The point on the unit circle is (cos θ, sin θ).', 'Use the 30-60-90 or 45-45-90 triangle, and the quadrant for the sign.'], steps: frame(`Evaluate ${q}.`, 'Reference angle + quadrant sign.', [`${q} = ${a}`], '✓'), explanation: `${q} = ${a}.`, verify: { kind: 'choice' } };
  },
  'law-of-sines': (r) => {
    const a = ri(r, 4, 15), b = ri(r, 4, 15), C = ri(r, 30, 120); const c = round(Math.sqrt(a * a + b * b - 2 * a * b * Math.cos((C * Math.PI) / 180)), 2);
    return { prompt: `In triangle ABC, a = ${a}, b = ${b}, and angle C = ${C}°. Find side c (2 decimal places).`, answerType: 'number', answer: n(c), tolerance: 0.011, hints: ['You know two sides and the angle between them.', 'Use the law of cosines: c² = a² + b² − 2ab cos C.', `c² = ${a * a} + ${b * b} − ${2 * a * b} cos ${C}°.`], steps: frame('Find side c.', 'Law of cosines (SAS).', [`c² = ${a * a + b * b} − ${2 * a * b}·cos ${C}°`, `c ≈ ${c}`], 'Triangle inequality holds ✓'), explanation: `c ≈ ${c}.`, verify: { kind: 'numeric', expr: `sqrt(${a}^2+${b}^2-2*${a}*${b}*cos(${C} deg))` } };
  },

  // ───────────────────────── CALCULUS
  limits: (r, d) => {
    const kind = ri(r, 0, d >= 3 ? 2 : 1);
    if (kind === 0) { const a = nz(r, -6, 6); return { prompt: `Evaluate lim (x→${a}) (x² − ${a * a}) / (x ${sgn(-a)})`, answerType: 'number', answer: n(2 * a), hints: ['Direct substitution gives 0/0 — factor first.', 'x² − a² = (x − a)(x + a).', `Cancel (x ${sgn(-a)}) and substitute x = ${a}.`], steps: frame('Evaluate a 0/0 limit.', 'Factor and cancel.', [`= lim (x ${sgn(a)})`, `= ${a} ${sgn(a)} = ${2 * a}`], `Values near x = ${a} approach ${2 * a} ✓`), explanation: `The limit is ${2 * a}.`, verify: { kind: 'numeric', expr: `((${a}+1e-7)^2-${a * a})/((${a}+1e-7)-${a})` } }; }
    if (kind === 1) { const a = ri(r, -3, 3), p = poly([[nz(r, -3, 3), 2], [ri(r, -5, 5), 1], [ri(r, -5, 5), 0]]); const val = evalSimple(p.math, { x: a }); return { prompt: `Evaluate lim (x→${a}) (${p.show})`, answerType: 'number', answer: n(val), hints: ['Polynomials are continuous.', 'You can substitute directly.', `Plug in x = ${a}.`], steps: frame('Limit of a polynomial.', 'Direct substitution.', [`= ${val}`], '✓'), explanation: `= ${val}.`, verify: { kind: 'numeric', expr: p.math.replaceAll('x', `(${a})`) } }; }
    const a = nz(r, -5, 6), b = nz(r, 1, 6), c = ri(r, -9, 9), e = ri(r, -9, 9);
    return { prompt: `Evaluate lim (x→∞) (${a}x² ${sgn(c)}x) / (${b}x² ${sgn(e)})`, answerType: 'fraction', answer: frac(a, b), hints: ['Compare the highest powers.', 'Divide every term by x²; terms like c/x → 0.', 'The limit is the ratio of the leading coefficients.'], steps: frame('Limit at infinity.', 'Leading terms dominate.', [`= ${a}/${b} = ${frac(a, b)}`], '✓'), explanation: `= ${frac(a, b)}.`, verify: { kind: 'numeric', expr: `${a}/${b}` } };
  },
  'derivative-power': (r, d) => {
    const terms: [number, number][] = [[nz(r, -5, 6), ri(r, 2, d >= 3 ? 5 : 3)], [ri(r, -6, 6), 1], [ri(r, -9, 9), 0]]; if (d >= 3) terms.unshift([nz(r, -3, 3), ri(r, 4, 6)]);
    const f = poly(terms); const df = poly(terms.filter(([, p]) => p > 0).map(([c, p]) => [c * p, p - 1]));
    if (d >= 4) { const k = ri(r, -2, 3); const val = terms.reduce((s, [c, p]) => s + (p > 0 ? c * p * k ** (p - 1) : 0), 0); return { prompt: `If f(x) = ${f.show}, find f′(${k}).`, answerType: 'number', answer: n(val), hints: ['Differentiate first, then substitute.', 'Power rule: d/dx xⁿ = n·xⁿ⁻¹.', `f′(x) = ${df.show}.`], steps: frame('Evaluate a derivative.', 'Differentiate, then substitute.', [`f′(x) = ${df.show}`, `f′(${k}) = ${val}`], '✓'), explanation: `f′(${k}) = ${val}.`, verify: { kind: 'numeric', expr: df.math.replaceAll('x', `(${k})`) } }; }
    return { prompt: `Differentiate: f(x) = ${f.show}`, answerType: 'expression', answer: df.math.replace(/\(([-\d]+)\)\*x\^1/g, '$1x').replace(/\(([-\d]+)\)\*x\^0/g, '$1').replace(/\(([-\d]+)\)\*x\^(\d+)/g, '$1x^$2').replace(/\+ -/g, '- '), variable: 'x', hints: ['Differentiate term by term.', 'Power rule: bring the exponent down and subtract 1. Constants differentiate to 0.', `d/dx(${f.show.split(' ')[0]}) first.`], steps: frame('Find f′(x).', 'Power rule term by term.', [`f′(x) = ${df.show}`], 'Degree dropped by one ✓'), explanation: `f′(x) = ${df.show}.`, verify: { kind: 'derivative', f: f.math, variable: 'x' }, mistakes: [] };
  },
  'derivative-rules': (r, d) => {
    const kind = ri(r, 0, d >= 3 ? 3 : 1);
    if (kind === 0) { const a = nz(r, -4, 5), b = ri(r, -6, 6), m = ri(r, 2, 5); const show = `(${a}x ${sgn(b)})${superscript(m)}`; return { prompt: `Differentiate: f(x) = ${show}`, answerType: 'expression', answer: `${m * a}(${a}x ${b < 0 ? '-' : '+'} ${Math.abs(b)})^${m - 1}`, variable: 'x', hints: ['This is a composition — use the chain rule.', 'Derivative of the outside × derivative of the inside.', `Outside: u^${m} → ${m}u^${m - 1}; inside: ${a}x ${sgn(b)} → ${a}.`], steps: frame('Chain rule.', 'f′ = outer′(inner)·inner′.', [`f′(x) = ${m}(${a}x ${sgn(b)})^${m - 1} · ${a}`, `= ${m * a}(${a}x ${sgn(b)})^${m - 1}`], '✓'), explanation: `f′(x) = ${m * a}(${a}x ${sgn(b)})^${m - 1}.`, verify: { kind: 'derivative', f: `(${a}*x+${b})^${m}`, variable: 'x' }, mistakes: [{ answer: `${m}(${a}x ${b < 0 ? '-' : '+'} ${Math.abs(b)})^${m - 1}`, type: 'forgot-inner', message: `Close! Don’t forget to multiply by the derivative of the inside (${a}).` }] }; }
    if (kind === 1) { const m = ri(r, 2, 4), c = nz(r, -5, 5); return { prompt: `Differentiate: f(x) = x${superscript(m)}(x ${sgn(c)})`, answerType: 'expression', answer: `${m + 1}x^${m} ${m * c < 0 ? '-' : '+'} ${Math.abs(m * c)}x^${m - 1}`.replace('x^1', 'x'), variable: 'x', hints: ['Use the product rule (or expand first).', '(uv)′ = u′v + uv′.', `u = x^${m}, v = x ${sgn(c)}.`], steps: frame('Product rule.', '(uv)′ = u′v + uv′.', [`= ${m}x^${m - 1}(x ${sgn(c)}) + x^${m}`, `= ${m + 1}x^${m} ${sgn(m * c)}x^${m - 1}`], '✓'), explanation: `f′(x) = ${m + 1}x^${m} ${sgn(m * c)}x^${m - 1}.`, verify: { kind: 'derivative', f: `x^${m}*(x+${c})`, variable: 'x' }, mistakes: [{ answer: `${m}x^${m - 1}`, type: 'product-of-derivatives', message: 'The derivative of a product is NOT the product of the derivatives. Use u′v + uv′.' }] }; }
    const a = nz(r, -4, 5); const trig = kind === 2;
    return { prompt: `Differentiate: f(x) = ${trig ? `sin(${a}x)` : `e^(${a}x)`}`, answerType: 'expression', answer: trig ? `${a}cos(${a}x)` : `${a}e^(${a}x)`, variable: 'x', hints: ['Chain rule again.', trig ? 'd/dx sin(u) = cos(u)·u′.' : 'd/dx eᵘ = eᵘ·u′.', `u = ${a}x, u′ = ${a}.`], steps: frame('Chain rule.', 'Outer derivative × inner derivative.', [trig ? `= cos(${a}x)·${a}` : `= e^(${a}x)·${a}`], '✓'), explanation: `f′(x) = ${trig ? `${a}cos(${a}x)` : `${a}e^(${a}x)`}.`, verify: { kind: 'derivative', f: trig ? `sin(${a}*x)` : `e^(${a}*x)`, variable: 'x' } };
  },
  'integrals-power': (r, d) => {
    const terms: [number, number][] = [[ri(r, 1, 4) * (d >= 3 ? 3 : 1), ri(r, 1, 3)], [nz(r, -6, 6), 0]]; if (d >= 3) terms.unshift([nz(r, -4, 4) * 4, 3]);
    const f = poly(terms);
    const parts = terms.map(([c, p], i) => {
      const co = frac(c, p + 1); const neg = co.startsWith('-'); const abs = neg ? co.slice(1) : co;
      const body = `${abs === '1' ? '' : abs.includes('/') ? `(${abs})` : abs}x${p + 1 === 1 ? '' : `^${p + 1}`}`;
      return (i === 0 ? (neg ? '-' : '') : neg ? ' - ' : ' + ') + body;
    }).join('');
    return { prompt: `Find the antiderivative: ∫ (${f.show}) dx   (you may omit + C)`, answerType: 'antiderivative', answer: parts, variable: 'x', hints: ['Reverse the power rule.', '∫ xⁿ dx = xⁿ⁺¹/(n + 1) + C.', 'Integrate each term separately.'], steps: frame('Find F with F′ = f.', 'Reverse power rule: raise the power by one and divide by the new power.', [`F(x) = ${parts} + C`], 'Differentiate F to get back f ✓'), explanation: `∫ (${f.show}) dx = ${parts} + C.`, verify: { kind: 'antiderivative', f: f.math, variable: 'x' } };
  },
  'definite-integrals': (r) => {
    const a = ri(r, 0, 2), b = a + ri(r, 1, 3); const c2 = ri(r, 1, 3) * 3, c1 = ri(r, -4, 4) * 2, c0 = ri(r, -5, 5);
    const F = (x: number) => (c2 / 3) * x ** 3 + (c1 / 2) * x ** 2 + c0 * x; const val = F(b) - F(a); const f = poly([[c2, 2], [c1, 1], [c0, 0]]);
    return { prompt: `Evaluate ∫ from ${a} to ${b} of (${f.show}) dx`, answerType: 'number', answer: n(val), hints: ['Find an antiderivative first.', 'Then compute F(b) − F(a).', `F(x) = ${n(c2 / 3)}x³ ${sgn(c1 / 2)}x² ${sgn(c0)}x.`], steps: frame('Definite integral.', 'Fundamental Theorem of Calculus.', [`F(${b}) = ${n(F(b))}`, `F(${a}) = ${n(F(a))}`, `${n(F(b))} − ${n(F(a))} = ${n(val)}`], '✓'), explanation: `= ${n(val)}.`, verify: { kind: 'numeric', expr: `${F(b)}-${F(a)}` }, mistakes: [{ answer: n(F(a) - F(b)), type: 'reversed-limits', message: 'Compute F(upper) − F(lower), not the other way around.' }] };
  },
  optimization: (r) => {
    const kind = ri(r, 0, 1);
    if (kind === 0) { const P = ri(r, 10, 60) * 4; return { prompt: `A farmer has ${P} m of fencing to make a rectangular pen. What is the maximum area possible (m²)?`, answerType: 'number', unit: 'm²', answer: n((P / 4) ** 2), hints: ['Let one side be x; the other is (P/2 − x).', `A(x) = x(${P / 2} − x). Find where A′(x) = 0.`, `A′(x) = ${P / 2} − 2x.`], steps: frame('Maximize area.', 'Set the derivative to zero.', [`A(x) = x(${P / 2} − x)`, `A′ = ${P / 2} − 2x = 0 → x = ${P / 4}`, `A = ${P / 4}² = ${(P / 4) ** 2}`], 'A″ = −2 < 0 → maximum ✓'), explanation: `Max area = ${(P / 4) ** 2} m² (a square).`, verify: { kind: 'numeric', expr: `(${P}/4)^2` } }; }
    const a = ri(r, 1, 4), b = ri(r, 2, 10) * 2 * a, c = ri(r, -10, 20); const xv = b / (2 * a); const max = -a * xv * xv + b * xv + c;
    return { prompt: `Find the maximum value of f(x) = −${a === 1 ? '' : a}x² + ${b}x ${sgn(c)}.`, answerType: 'number', answer: n(max), hints: ['Find the critical point.', 'Set f′(x) = 0.', `f′(x) = −${2 * a}x + ${b}.`], steps: frame('Maximize f.', 'f′(x) = 0.', [`x = ${xv}`, `f(${xv}) = ${max}`], 'Leading coefficient negative → maximum ✓'), explanation: `Maximum value ${max} at x = ${xv}.`, verify: { kind: 'numeric', expr: `-${a}*${xv}^2+${b}*${xv}+${c}` } };
  },
  'integration-by-parts': (r) => {
    const a = nz(r, -3, 3); const exp = r() < 0.5;
    return exp
      ? { prompt: `Evaluate ∫ x·e^(${a}x) dx   (you may omit + C)`, answerType: 'antiderivative', answer: `x*e^(${a}x)/${a} - e^(${a}x)/${a * a}`, variable: 'x', hints: ['Use ∫u dv = uv − ∫v du.', 'Let u = x (gets simpler) and dv = e^(ax) dx.', `v = e^(${a}x)/${a}.`], steps: frame('Integrate a product.', 'Integration by parts with u = x.', [`uv = x·e^(${a}x)/${a}`, `∫v du = e^(${a}x)/${a * a}`, `Result: x·e^(${a}x)/${a} − e^(${a}x)/${a * a} + C`], 'Differentiate to check ✓'), explanation: `= x·e^(${a}x)/${a} − e^(${a}x)/${a * a} + C.`, verify: { kind: 'antiderivative', f: `x*e^(${a}*x)`, variable: 'x' } }
      : { prompt: `Evaluate ∫ x·cos(${Math.abs(a)}x) dx   (you may omit + C)`, answerType: 'antiderivative', answer: `x*sin(${Math.abs(a)}x)/${Math.abs(a)} + cos(${Math.abs(a)}x)/${a * a}`, variable: 'x', hints: ['Integration by parts.', 'u = x, dv = cos(kx) dx.', `v = sin(${Math.abs(a)}x)/${Math.abs(a)}.`], steps: frame('Integrate a product.', 'By parts.', [`= x·sin(${Math.abs(a)}x)/${Math.abs(a)} − ∫ sin(${Math.abs(a)}x)/${Math.abs(a)} dx`, `= x·sin(${Math.abs(a)}x)/${Math.abs(a)} + cos(${Math.abs(a)}x)/${a * a} + C`], 'Differentiate to check ✓'), explanation: `= x·sin(${Math.abs(a)}x)/${Math.abs(a)} + cos(${Math.abs(a)}x)/${a * a} + C.`, verify: { kind: 'antiderivative', f: `x*cos(${Math.abs(a)}*x)`, variable: 'x' } };
  },
  'partial-derivatives': (r) => {
    const a = nz(r, -4, 5), m = ri(r, 1, 3), k = ri(r, 1, 3), b = nz(r, -5, 5), c = ri(r, -4, 4); const wrt = r() < 0.5 ? 'x' : 'y';
    const fShow = `${a}x${superscript(m)}y${superscript(k)} ${sgn(b)}xy ${sgn(c)}y²`.replaceAll('¹', ''); const fMath = `${a}*x^${m}*y^${k}+${b}*x*y+${c}*y^2`;
    const ans = wrt === 'x' ? `${a * m}x^${m - 1}y^${k} + ${b}y` : `${a * k}x^${m}y^${k - 1} + ${b}x + ${2 * c}y`;
    return { prompt: `f(x, y) = ${fShow}. Find ∂f/∂${wrt}.`, answerType: 'expression', answer: ans, hints: [`Treat ${wrt === 'x' ? 'y' : 'x'} as a constant.`, 'Differentiate each term with the power rule in the chosen variable.', `Terms without ${wrt} vanish.`], steps: frame(`Partial derivative in ${wrt}.`, 'Hold the other variable constant.', [`∂f/∂${wrt} = ${ans}`], '✓'), explanation: `∂f/∂${wrt} = ${ans}.`, verify: { kind: 'derivative', f: fMath, variable: wrt } };
  },
  'separable-ode': (r) => {
    const y0 = ri(r, 2, 50) * 10, k = pick(r, [0.05, 0.1, 0.2, -0.1, -0.05, 0.3]), t = ri(r, 2, 10); const val = round(y0 * Math.exp(k * t), 2);
    return { prompt: `dy/dt = ${k}y with y(0) = ${y0}. Find y(${t}) to 2 decimal places.`, answerType: 'number', answer: n(val), tolerance: Math.max(0.011, val * 0.0005), hints: ['Separate: dy/y = k dt.', 'Integrate: ln|y| = kt + C → y = y₀e^(kt).', `y = ${y0}e^(${k}t).`], steps: frame('Solve the ODE.', 'Separation of variables.', [`y(t) = ${y0}e^(${k}t)`, `y(${t}) = ${y0}e^(${n(k * t)}) ≈ ${val}`], k > 0 ? 'Growth ✓' : 'Decay ✓'), explanation: `y(${t}) ≈ ${val}.`, verify: { kind: 'numeric', expr: `${y0}*e^(${k}*${t})` } };
  },
  'taylor-series': (r) => {
    const a = nz(r, -3, 3), k = ri(r, 2, 4);
    return { prompt: `What is the coefficient of x${superscript(k)} in the Maclaurin series of e^(${a}x)?`, answerType: 'fraction', answer: frac(a ** k, fact(k)), hints: ['eᵘ = Σ uⁿ/n!.', `Substitute u = ${a}x.`, `The x^${k} term is (${a}x)^${k}/${k}!.`], steps: frame('Find a Taylor coefficient.', 'Use the known series for eᵘ.', [`(${a})^${k}/${k}! = ${a ** k}/${fact(k)} = ${frac(a ** k, fact(k))}`], 'Matches f⁽ⁿ⁾(0)/n! ✓'), explanation: `= ${frac(a ** k, fact(k))}.`, verify: { kind: 'numeric', expr: `(${a})^${k}/factorial(${k})` } };
  },
  'series-convergence': (r) => {
    const items: [string, string, string][] = [['Σ (1/2)ⁿ', 'Converges', 'Geometric with |r| = 1/2 < 1.'], ['Σ 1/n', 'Diverges', 'The harmonic series diverges (p = 1).'], ['Σ 1/n²', 'Converges', 'p-series with p = 2 > 1.'], ['Σ n/(n + 1)', 'Diverges', 'Terms → 1 ≠ 0 (divergence test).'], ['Σ (3/2)ⁿ', 'Diverges', 'Geometric with |r| = 3/2 > 1.'], ['Σ 1/√n', 'Diverges', 'p-series with p = 1/2 ≤ 1.'], ['Σ (−1)ⁿ/n', 'Converges', 'Alternating series test: terms decrease to 0.'], ['Σ 1/n!', 'Converges', 'Ratio test: ratio → 0 < 1.']];
    const [s, ans, why] = pick(r, items);
    return { prompt: `Does the series ${s} (n from 1 to ∞) converge or diverge?`, answerType: 'choice', answer: ans, choices: ['Converges', 'Diverges'], hints: ['Do the terms go to 0? If not, it diverges.', 'Recognize the type: geometric, p-series, alternating…', 'Geometric: |r| < 1. p-series: p > 1.'], steps: frame('Test for convergence.', 'Identify the series type.', [why], '✓'), explanation: `${ans}. ${why}`, verify: { kind: 'choice' } };
  },
  'newtons-method': (r) => {
    const N = pick(r, [2, 3, 5, 7, 10, 11, 13]); const x0 = Math.round(Math.sqrt(N)) || 1; const x1 = round(x0 - (x0 * x0 - N) / (2 * x0), 4);
    return { prompt: `Use one step of Newton’s method on f(x) = x² − ${N} starting at x₀ = ${x0}. What is x₁? (4 decimal places)`, answerType: 'number', answer: n(x1), tolerance: 0.0002, hints: ['xₙ₊₁ = xₙ − f(xₙ)/f′(xₙ).', `f′(x) = 2x.`, `f(${x0}) = ${x0 * x0 - N}, f′(${x0}) = ${2 * x0}.`], steps: frame(`Approximate √${N}.`, 'Newton’s method.', [`x₁ = ${x0} − (${x0 * x0 - N})/${2 * x0} = ${x1}`], `√${N} ≈ ${round(Math.sqrt(N), 4)} — closer than x₀ ✓`), explanation: `x₁ = ${x1}.`, verify: { kind: 'numeric', expr: `${x0}-(${x0}^2-${N})/(2*${x0})` } };
  },

  // ───────────────────────── LINEAR ALGEBRA
  'matrix-mult': (r, d) => {
    const A = [[ri(r, -4, 5), ri(r, -4, 5)], [ri(r, -4, 5), ri(r, -4, 5)]], B = [[ri(r, -4, 5), ri(r, -4, 5)], [ri(r, -4, 5), ri(r, -4, 5)]];
    const C = [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
    const fmt = (M: number[][]) => `[[${M[0].join(', ')}], [${M[1].join(', ')}]]`;
    if (d <= 3) { const i = ri(r, 0, 1), j = ri(r, 0, 1); return { prompt: `A = ${fmt(A)}, B = ${fmt(B)}. Find the entry in row ${i + 1}, column ${j + 1} of AB.`, answerType: 'number', answer: n(C[i][j]), visual: { type: 'matrix', rows: A }, hints: [`Use row ${i + 1} of A and column ${j + 1} of B.`, 'Multiply matching entries and add (dot product).', `${A[i][0]}·${par(B[0][j])} + ${A[i][1]}·${par(B[1][j])}.`], steps: frame('One entry of a product.', 'Row · column.', [`${A[i][0] * B[0][j]} + ${A[i][1] * B[1][j]} = ${C[i][j]}`], '✓'), explanation: `(AB)${i + 1}${j + 1} = ${C[i][j]}.`, verify: { kind: 'numeric', expr: `${A[i][0]}*${B[0][j]}+${A[i][1]}*${B[1][j]}` } }; }
    return { prompt: `A = ${fmt(A)}, B = ${fmt(B)}. Compute AB. Enter the four entries row by row, separated by commas.`, answerType: 'pair', answer: `(${C[0][0]}, ${C[0][1]}, ${C[1][0]}, ${C[1][1]})`, hints: ['Each entry is a row of A dotted with a column of B.', '(AB)ᵢⱼ = Σ AᵢₖBₖⱼ.', `Top-left: ${A[0][0]}·${par(B[0][0])} + ${A[0][1]}·${par(B[1][0])}.`], steps: frame('Multiply 2×2 matrices.', 'Row-by-column.', [`AB = ${fmt(C)}`], '✓'), explanation: `AB = ${fmt(C)}.`, verify: { kind: 'none', reason: 'computed directly' } };
  },
  determinants: (r, d) => {
    if (d <= 3) { const [a, b, c, e] = [ri(r, -6, 8), ri(r, -6, 8), ri(r, -6, 8), ri(r, -6, 8)]; return { prompt: `Find det [[${a}, ${b}], [${c}, ${e}]].`, answerType: 'number', answer: n(a * e - b * c), visual: { type: 'matrix', rows: [[a, b], [c, e]] }, hints: ['For 2×2: ad − bc.', 'Multiply the main diagonal, subtract the other diagonal.', `${a}·${par(e)} − ${b}·${par(c)}.`], steps: frame('2×2 determinant.', 'ad − bc.', [`${a * e} − ${b * c} = ${a * e - b * c}`], a * e - b * c === 0 ? 'Zero → not invertible ✓' : 'Non-zero → invertible ✓'), explanation: `det = ${a * e - b * c}.`, verify: { kind: 'numeric', expr: `det([[${a},${b}],[${c},${e}]])` }, mistakes: [{ answer: n(a * e + b * c), type: 'added-diagonals', message: 'Subtract the second diagonal product: ad − bc.' }] }; }
    const M = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ri(r, -3, 4)));
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    return { prompt: `Find the determinant of [[${M[0].join(', ')}], [${M[1].join(', ')}], [${M[2].join(', ')}]].`, answerType: 'number', answer: n(det), visual: { type: 'matrix', rows: M }, hints: ['Expand along the first row.', 'det = a(ei − fh) − b(di − fg) + c(dh − eg).', 'Watch the alternating signs + − +.'], steps: frame('3×3 determinant.', 'Cofactor expansion.', [`= ${det}`], '✓'), explanation: `det = ${det}.`, verify: { kind: 'numeric', expr: `det([[${M[0]}],[${M[1]}],[${M[2]}]])` } };
  },
  eigenvalues: (r) => {
    const l1 = ri(r, -4, 6); let l2 = ri(r, -4, 6); while (l2 === l1) l2 = ri(r, -4, 6);
    const P = pick(r, [[[1, 1], [1, 2]], [[2, 1], [1, 1]], [[1, 2], [1, 3]], [[1, 0], [2, 1]], [[1, 1], [0, 1]]]); const det = P[0][0] * P[1][1] - P[0][1] * P[1][0];
    const Pi = [[P[1][1] / det, -P[0][1] / det], [-P[1][0] / det, P[0][0] / det]];
    const PD = [[P[0][0] * l1, P[0][1] * l2], [P[1][0] * l1, P[1][1] * l2]];
    const A = [[PD[0][0] * Pi[0][0] + PD[0][1] * Pi[1][0], PD[0][0] * Pi[0][1] + PD[0][1] * Pi[1][1]], [PD[1][0] * Pi[0][0] + PD[1][1] * Pi[1][0], PD[1][0] * Pi[0][1] + PD[1][1] * Pi[1][1]]].map((row) => row.map((v) => Math.round(v)));
    const tr = A[0][0] + A[1][1], dt = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    return { prompt: `Find the eigenvalues of A = [[${A[0].join(', ')}], [${A[1].join(', ')}]]. Separate them with a comma.`, answerType: 'set', answer: [l1, l2].sort((a, b) => a - b).join(', '), visual: { type: 'matrix', rows: A }, hints: ['Solve det(A − λI) = 0.', 'For 2×2: λ² − (trace)λ + det = 0.', `trace = ${tr}, det = ${dt}.`], steps: frame('Find eigenvalues.', 'Characteristic polynomial.', [`λ² ${sgn(-tr)}λ ${sgn(dt)} = 0`, `(λ ${sgn(-l1)})(λ ${sgn(-l2)}) = 0`, `λ = ${l1}, ${l2}`], `Sum = ${l1 + l2} = trace ✓; product = ${l1 * l2} = det ✓`), explanation: `λ = ${l1} and ${l2}.`, verify: { kind: 'roots', expr: `x^2-${tr}*x+${dt}`, variable: 'x' } };
  },

  // ───────────────────────── DISCRETE / NUMBER THEORY / PROOF / ABSTRACT / ANALYSIS
  'gcd-euclid': (r) => {
    const g = ri(r, 2, 30), a = g * ri(r, 5, 40); let b = g * ri(r, 5, 40); while (gcd(a, b) !== g) b = g * ri(r, 5, 40);
    const steps: string[] = []; let [x, y] = [Math.max(a, b), Math.min(a, b)]; while (y) { steps.push(`${x} = ${Math.floor(x / y)}·${y} + ${x % y}`); [x, y] = [y, x % y]; }
    return { prompt: `Use the Euclidean algorithm to find gcd(${a}, ${b}).`, answerType: 'number', answer: n(g), hints: ['Divide the larger by the smaller and take the remainder.', 'gcd(a, b) = gcd(b, a mod b). Repeat until the remainder is 0.', steps[0]], steps: frame('Find the gcd.', 'Euclidean algorithm.', [...steps, `Last non-zero remainder: ${g}`], `${a} ÷ ${g} and ${b} ÷ ${g} are integers ✓`), explanation: `gcd(${a}, ${b}) = ${g}.`, verify: { kind: 'numeric', expr: `gcd(${a},${b})` } };
  },
  modular: (r, d) => {
    const m = ri(r, 5, 13);
    if (d >= 3 && r() < 0.5) { const a = ri(r, 2, 9), k = ri(r, 3, 12); let v = 1; for (let i = 0; i < k; i++) v = (v * a) % m; return { prompt: `Compute ${a}${superscript(k)} mod ${m}.`, answerType: 'number', answer: n(v), hints: ['Reduce as you go.', `Compute ${a}², ${a}³, … each time taking mod ${m}.`, `${a}² mod ${m} = ${(a * a) % m}.`], steps: frame('Modular power.', 'Repeated multiplication mod m.', [`Result: ${v}`], '✓'), explanation: `${a}^${k} ≡ ${v} (mod ${m}).`, verify: { kind: 'numeric', expr: `mod(${a}^${k},${m})` } }; }
    const a = ri(r, 20, 200), b = ri(r, 2, 30), c = ri(r, 0, 50); const v = (a * b + c) % m;
    return { prompt: `Compute (${a} × ${b} + ${c}) mod ${m}.`, answerType: 'number', answer: n(v), hints: [`Reduce each number mod ${m} first.`, `${a} mod ${m} = ${a % m}.`, 'Then multiply, add and reduce again.'], steps: frame('Modular arithmetic.', 'Reduce early.', [`(${a % m} × ${b % m} + ${c % m}) mod ${m} = ${v}`], '✓'), explanation: `= ${v}.`, verify: { kind: 'numeric', expr: `mod(${a}*${b}+${c},${m})` } };
  },
  'logic-truth': (r) => {
    const p = r() < 0.5, q = r() < 0.5; const ops: [string, (a: boolean, b: boolean) => boolean, string][] = [['p ∧ q', (a, b) => a && b, 'AND is true only when both are true.'], ['p ∨ q', (a, b) => a || b, 'OR is true when at least one is true.'], ['p → q', (a, b) => !a || b, 'An implication is false only when p is true and q is false.'], ['¬p ∨ q', (a, b) => !a || b, 'Negate p first, then OR.'], ['p ↔ q', (a, b) => a === b, 'Biconditional is true when both have the same value.'], ['¬(p ∧ q)', (a, b) => !(a && b), 'Evaluate inside the brackets, then negate.']];
    const [show, fn, why] = pick(r, ops); const ans = fn(p, q) ? 'True' : 'False';
    return { prompt: `If p is ${p ? 'True' : 'False'} and q is ${q ? 'True' : 'False'}, what is the truth value of ${show}?`, answerType: 'choice', answer: ans, choices: ['True', 'False'], hints: ['Substitute the truth values.', why, 'Work from the inside out.'], steps: frame('Evaluate a logical statement.', 'Use the truth table.', [`${show} = ${ans}`], '✓'), explanation: `${ans}. ${why}`, verify: { kind: 'choice' } };
  },
  'proofs-induction': (r, d) => {
    if (d <= 2) { const k = ri(r, 10, 100); return { prompt: `Using 1 + 2 + … + n = n(n + 1)/2, find 1 + 2 + … + ${k}.`, answerType: 'number', answer: n((k * (k + 1)) / 2), hints: ['Substitute n into the formula.', 'n(n + 1)/2.', `${k} × ${k + 1} ÷ 2.`], steps: frame('Use a proven formula.', 'Substitute.', [`${k}·${k + 1}/2 = ${(k * (k + 1)) / 2}`], '✓'), explanation: `= ${(k * (k + 1)) / 2}.`, verify: { kind: 'numeric', expr: `${k}*(${k}+1)/2` } }; }
    if (d === 3) { const correct = 'Assume the statement is true for n = k, then prove it for n = k + 1.'; return { prompt: 'In a proof by induction, what is the inductive step?', answerType: 'choice', answer: correct, choices: choices(r, correct, ['Check the statement for a few values of n.', 'Assume the statement is true for all n, then simplify.', 'Prove the statement for n = 1 only.']), hints: ['There are two parts: base case and inductive step.', 'The step links one case to the next.', 'Think dominoes: if one falls, the next falls.'], steps: frame('Structure of induction.', 'Base case + inductive step.', [correct], '✓'), explanation: correct, verify: { kind: 'choice' } }; }
    const k = ri(r, 5, 20); return { prompt: `It can be proved by induction that 1² + 2² + … + n² = n(n + 1)(2n + 1)/6. Compute 1² + 2² + … + ${k}².`, answerType: 'number', answer: n((k * (k + 1) * (2 * k + 1)) / 6), hints: ['Substitute n = ' + k + '.', 'n(n + 1)(2n + 1)/6.', `${k}·${k + 1}·${2 * k + 1}/6.`], steps: frame('Apply the formula.', 'Substitute.', [`= ${(k * (k + 1) * (2 * k + 1)) / 6}`], '✓'), explanation: `= ${(k * (k + 1) * (2 * k + 1)) / 6}.`, verify: { kind: 'numeric', expr: `${k}*(${k}+1)*(2*${k}+1)/6` } };
  },
  'group-order': (r) => {
    const nn = pick(r, [6, 8, 9, 10, 12, 14, 15, 16, 18, 20]); const a = ri(r, 1, nn - 1); const ord = nn / gcd(a, nn);
    return { prompt: `In the group (ℤ${subscript(nn)}, +), what is the order of the element ${a}?`, answerType: 'number', answer: n(ord), hints: [`Find the smallest k > 0 with k·${a} ≡ 0 (mod ${nn}).`, 'ord(a) = n / gcd(a, n).', `gcd(${a}, ${nn}) = ${gcd(a, nn)}.`], steps: frame('Order of an element.', 'n / gcd(a, n).', [`${nn} / ${gcd(a, nn)} = ${ord}`], `${ord}·${a} = ${ord * a} ≡ 0 (mod ${nn}) ✓ and ${ord} divides ${nn} (Lagrange) ✓`), explanation: `ord(${a}) = ${ord}.`, verify: { kind: 'numeric', expr: `${nn}/gcd(${a},${nn})` } };
  },
  'real-analysis-sup': (r) => {
    const items: [string, string, string[], string][] = [['sup { 1 − 1/n : n ∈ ℕ }', '1', ['0', '1/2', 'Does not exist'], 'The values approach 1 but never reach it; 1 is the least upper bound.'], ['inf { 1/n : n ∈ ℕ }', '0', ['1', '−1', 'Does not exist'], 'Values decrease toward 0; 0 is the greatest lower bound but not attained.'], ['sup { x ∈ ℚ : x² < 2 }', '√2', ['2', '1.41', 'Does not exist in ℝ'], 'In ℝ the least upper bound is √2 (completeness).'], ['sup (0, 1)', '1', ['0', '0.999', 'Does not exist'], 'The open interval has supremum 1 though 1 ∉ (0,1).'], ['inf { x² : x ∈ ℝ }', '0', ['1', '−∞', 'Does not exist'], '0 is attained at x = 0.'], ['sup { (−1)ⁿ : n ∈ ℕ }', '1', ['−1', '0', 'Does not exist'], 'The set is {−1, 1}.']];
    const [s, a, ds, why] = pick(r, items);
    return { prompt: `What is ${s}?`, answerType: 'choice', answer: a, choices: choices(r, a, ds), hints: ['List a few elements of the set.', 'The supremum is the LEAST upper bound; it need not be in the set.', 'Is the bound approached or attained?'], steps: frame('Find the bound.', 'Examine the behavior of the elements.', [why], '✓'), explanation: `${s} = ${a}. ${why}`, verify: { kind: 'choice' } };
  },
};

const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
function subscript(v: number) { return String(v).split('').map((c) => SUB[c] ?? c).join(''); }

/** Tiny evaluator for the simple polynomial strings we build (avoids pulling mathjs into hot paths). */
function evalSimple(expr: string, scope: Record<string, number>): number {
  // eslint-disable-next-line no-new-func
  const f = new Function(...Object.keys(scope), `return ${expr.replace(/\^/g, '**')};`);
  return Math.round(f(...Object.values(scope)) * 1e9) / 1e9;
}
