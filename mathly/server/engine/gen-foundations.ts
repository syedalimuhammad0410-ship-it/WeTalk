// Question generators: numbers, fractions, ratios, mental math, real-world math and puzzles.
import type { Draft, Rng } from './util.ts';
import { choices, dn, fact, frac, frame, gcd, lcm, money, n, nz, pick, ri, round, shuffle } from './util.ts';

type Gen = (r: Rng, d: number) => Draft;

const EMOJI = ['🍎', '⭐', '🐟', '🌸', '🚗', '🍪', '🎈', '🐞', '🍓', '⚽'];

export const foundationGenerators: Record<string, Gen> = {
  // ───────────────────────── NUMBERS
  'k-count': (r, d) => {
    const count = ri(r, 1, Math.min(20, 4 + d * 3)); const e = pick(r, EMOJI);
    return {
      prompt: `How many ${e} are there?`, answerType: 'number', answer: n(count), visual: { type: 'objects', emoji: e, count },
      hints: ['Touch or point to each one as you count.', 'Count each object exactly once. The last number you say is how many there are.', 'Try counting row by row so you don’t miss any.'],
      steps: frame('We want to know how many there are.', 'Count each one exactly once.', [`Counting: 1, 2, 3 … ${count}.`], `The last number we said was ${count}.`),
      explanation: `There are ${count}. When we count each object once, the last number we say tells us how many.`, verify: { kind: 'numeric', expr: `${count}` },
      mistakes: [{ answer: n(count + 1), type: 'double-count', message: 'Close! It looks like one object was counted twice.' }, { answer: n(count - 1), type: 'skipped', message: 'Close! It looks like one object was skipped.' }],
    };
  },
  'k-compare': (r, d) => {
    const max = 5 + d * 4; const a = ri(r, 0, max); let b = ri(r, 0, max); while (b === a) b = ri(r, 0, max);
    const bigger = r() < 0.6; const ans = bigger ? Math.max(a, b) : Math.min(a, b);
    return {
      prompt: `Which number is ${bigger ? 'bigger' : 'smaller'}: ${a} or ${b}?`, answerType: 'choice', answer: n(ans), choices: [n(a), n(b)],
      visual: { type: 'number-line', min: 0, max: Math.max(10, max), marks: [a, b] },
      hints: ['Find both numbers on the number line.', 'Numbers further to the right are bigger.', `Is ${a} to the left or right of ${b}?`],
      steps: frame(`We compare ${a} and ${b}.`, 'Use the number line: further right means bigger.', [`${Math.max(a, b)} is further right than ${Math.min(a, b)}.`], `${Math.max(a, b)} is bigger, ${Math.min(a, b)} is smaller.`),
      explanation: `${ans} is ${bigger ? 'bigger' : 'smaller'} because it is further ${bigger ? 'right' : 'left'} on the number line.`, verify: { kind: 'choice' },
    };
  },
  'k-add10': (r, d) => {
    const lim = d >= 4 ? 20 : 10; const a = ri(r, 0, lim - 1); const b = ri(r, 1, lim - a); const e = pick(r, EMOJI);
    return {
      prompt: `${a} + ${b} = ?`, answerType: 'number', answer: n(a + b), visual: a + b <= 12 ? { type: 'objects', emoji: e, count: a + b, groups: a } : undefined,
      hints: [`Start at ${Math.max(a, b)} and count on.`, 'Adding means putting two groups together.', `Count on ${Math.min(a, b)} more from ${Math.max(a, b)}.`],
      steps: frame('We put two groups together.', 'Start with the bigger number and count on.', [`Start at ${Math.max(a, b)}, count on ${Math.min(a, b)}: ${a + b}.`], `${a + b} − ${b} = ${a}, so it checks out.`),
      explanation: `${a} + ${b} = ${a + b}.`, verify: { kind: 'numeric', expr: `${a}+${b}` },
      mistakes: [{ answer: n(a + b - 1), type: 'off-by-one', message: 'So close — try counting on again carefully.' }],
    };
  },
  'k-sub10': (r, d) => {
    const lim = d >= 4 ? 20 : 10; const a = ri(r, 1, lim); const b = ri(r, 0, a); const e = pick(r, EMOJI);
    return {
      prompt: `${a} − ${b} = ?`, answerType: 'number', answer: n(a - b), visual: a <= 12 ? { type: 'objects', emoji: e, count: a } : undefined,
      hints: [`Start at ${a} and count back ${b}.`, 'Subtracting means taking away.', `What number plus ${b} makes ${a}?`],
      steps: frame(`We start with ${a} and take away ${b}.`, 'Count back.', [`From ${a}, count back ${b}: ${a - b}.`], `${a - b} + ${b} = ${a} ✓`),
      explanation: `${a} − ${b} = ${a - b}.`, verify: { kind: 'numeric', expr: `${a}-${b}` },
      mistakes: [{ answer: n(a + b), type: 'wrong-operation', message: 'It looks like you added. This one is taking away.' }],
    };
  },
  'place-value': (r, d) => {
    const len = d >= 3 ? 4 : 3; const digits = shuffle(r, [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, len);
    const num = Number(digits.join('')); const pos = ri(r, 0, len - 1); const digit = digits[pos]; const power = len - 1 - pos;
    const value = digit * 10 ** power; const names = ['ones', 'tens', 'hundreds', 'thousands'];
    return {
      prompt: `In the number ${num.toLocaleString('en-US')}, what is the value of the digit ${digit}?`, answerType: 'number', answer: n(value),
      hints: [`Which place is the ${digit} in?`, 'Each place is worth 10 times the place to its right: ones, tens, hundreds, thousands.', `The ${digit} is in the ${names[power]} place.`],
      steps: frame(`Find what the ${digit} is worth.`, 'Identify its place.', [`The ${digit} is in the ${names[power]} place.`, `${digit} × ${10 ** power} = ${value}.`], `${num} = ${digits.map((dg, i) => dg * 10 ** (len - 1 - i)).join(' + ')} ✓`),
      explanation: `The ${digit} is in the ${names[power]} place, so it is worth ${value}.`, verify: { kind: 'numeric', expr: `${digit}*10^${power}` },
      mistakes: [{ answer: n(digit), type: 'face-value', message: `That's the digit itself. What is it worth in the ${names[power]} place?` }],
    };
  },
  'add-2digit': (r, d) => {
    const big = d >= 4; let a = big ? ri(r, 100, 899) : ri(r, 11, 89); let b = big ? ri(r, 100, 999 - a) : ri(r, 11, 99 - a);
    if (d >= 2 && (a % 10) + (b % 10) < 10) { a = a - (a % 10) + ri(r, 5, 9); b = b - (b % 10) + ri(r, 5, 9); }
    const noCarry = Number(String(a).padStart(3, '0').split('').map((x, i) => (Number(x) + Number(String(b).padStart(3, '0')[i])) % 10).join(''));
    return {
      prompt: `${a} + ${b} = ?`, answerType: 'number', answer: n(a + b),
      hints: ['Add the ones first.', 'If the ones add to 10 or more, carry 1 ten to the tens column.', `Ones: ${a % 10} + ${b % 10} = ${(a % 10) + (b % 10)}.`],
      steps: frame(`Add ${a} and ${b}.`, 'Add ones, then tens (then hundreds), carrying when needed.', [`Ones: ${a % 10} + ${b % 10} = ${(a % 10) + (b % 10)}.`, `Total: ${a + b}.`], `Estimate: about ${Math.round(a / 10) * 10} + ${Math.round(b / 10) * 10} = ${Math.round(a / 10) * 10 + Math.round(b / 10) * 10} — close ✓`),
      explanation: `${a} + ${b} = ${a + b}.`, verify: { kind: 'numeric', expr: `${a}+${b}` },
      mistakes: noCarry !== a + b ? [{ answer: n(noCarry), type: 'forgot-carry', message: 'You’re close — check whether you carried the extra ten.' }] : [],
    };
  },
  'sub-2digit': (r, d) => {
    const big = d >= 4; let a = big ? ri(r, 300, 999) : ri(r, 30, 99); let b = big ? ri(r, 100, a - 10) : ri(r, 11, a - 1);
    if (d >= 2 && a % 10 >= b % 10 && a % 10 < 9) { b = b - (b % 10) + Math.min(9, (a % 10) + 1); if (b >= a) b = a - 1; }
    const wrong = Number(String(a).split('').map((x, i) => Math.abs(Number(x) - Number(String(b).padStart(String(a).length, '0')[i]))).join(''));
    return {
      prompt: `${a} − ${b} = ?`, answerType: 'number', answer: n(a - b),
      hints: ['Subtract the ones first.', 'If the top ones digit is smaller, borrow 1 ten (10 ones).', `Ones: can you take ${b % 10} from ${a % 10}?`],
      steps: frame(`Subtract ${b} from ${a}.`, 'Ones first, then tens, borrowing when needed.', [`Result: ${a - b}.`], `${a - b} + ${b} = ${a} ✓`),
      explanation: `${a} − ${b} = ${a - b}. Check by adding back: ${a - b} + ${b} = ${a}.`, verify: { kind: 'numeric', expr: `${a}-${b}` },
      mistakes: wrong !== a - b ? [{ answer: n(wrong), type: 'smaller-from-larger', message: 'It looks like the smaller digit was subtracted from the larger in each column. When the top digit is smaller, we borrow.' }] : [],
    };
  },
  'mult-facts': (r, d) => {
    const top = Math.min(12, 4 + d * 2); const a = ri(r, 2, top); const b = ri(r, 2, top); const e = pick(r, EMOJI);
    return {
      prompt: `${a} × ${b} = ?`, answerType: 'number', answer: n(a * b), visual: a * b <= 30 && d <= 2 ? { type: 'objects', emoji: e, count: a * b, groups: a } : undefined,
      hints: [`Think of ${a} groups of ${b}.`, 'Multiplication is repeated addition.', `${b} + ${b} … (${a} times).`],
      steps: frame(`${a} groups of ${b}.`, 'Use a fact you know or skip-count.', [`Skip count by ${b}: ${Array.from({ length: a }, (_, i) => b * (i + 1)).join(', ')}.`], `${a * b} ÷ ${a} = ${b} ✓`),
      explanation: `${a} × ${b} = ${a * b}.`, verify: { kind: 'numeric', expr: `${a}*${b}` },
      mistakes: [{ answer: n(a + b), type: 'wrong-operation', message: 'It looks like you added. × means groups of.' }],
    };
  },
  'div-facts': (r, d) => {
    const top = Math.min(12, 4 + d * 2); const b = ri(r, 2, top); const c = ri(r, 2, top); const a = b * c;
    return {
      prompt: `${a} ÷ ${b} = ?`, answerType: 'number', answer: n(c),
      hints: [`What times ${b} makes ${a}?`, 'Division is the inverse of multiplication.', `Skip count by ${b} until you reach ${a}.`],
      steps: frame(`Share ${a} into ${b} equal groups.`, `Find ? × ${b} = ${a}.`, [`${b} × ${c} = ${a}, so ${a} ÷ ${b} = ${c}.`], `${c} × ${b} = ${a} ✓`),
      explanation: `${a} ÷ ${b} = ${c} because ${b} × ${c} = ${a}.`, verify: { kind: 'numeric', expr: `${a}/${b}` },
    };
  },
  'multi-digit-mult': (r, d) => {
    const a = d <= 2 ? ri(r, 12, 99) : d <= 4 ? ri(r, 12, 99) : ri(r, 101, 999); const b = d <= 2 ? ri(r, 3, 9) : ri(r, 11, 49);
    const t = Math.floor(a / 10) * 10, o = a % 10;
    return {
      prompt: `${a} × ${b} = ?`, answerType: 'number', answer: n(a * b),
      hints: [`Split ${a} into ${t} + ${o}.`, 'Multiply each part, then add the partial products.', `${t} × ${b} = ${t * b}.`],
      steps: frame(`Multiply ${a} by ${b}.`, 'Use partial products (distributive property).', [`${t} × ${b} = ${t * b}`, `${o} × ${b} = ${o * b}`, `${t * b} + ${o * b} = ${a * b}`], `Estimate ${Math.round(a / 10) * 10} × ${b} ≈ ${Math.round(a / 10) * 10 * b} ✓`),
      explanation: `${a} × ${b} = ${a * b}.`, verify: { kind: 'numeric', expr: `${a}*${b}` },
    };
  },
  'long-division': (r, d) => {
    const divisor = d <= 3 ? ri(r, 2, 9) : ri(r, 11, 25); const q = ri(r, 12, d <= 2 ? 40 : 150); const rem = d >= 3 ? ri(r, 1, divisor - 1) : 0;
    const a = divisor * q + rem;
    if (rem === 0) return {
      prompt: `${a} ÷ ${divisor} = ?`, answerType: 'number', answer: n(q),
      hints: [`How many times does ${divisor} go into the first digits of ${a}?`, 'Divide, multiply, subtract, bring down — repeat.', `${divisor} × ${Math.floor(q / 10) * 10} = ${divisor * Math.floor(q / 10) * 10}.`],
      steps: frame(`Split ${a} into ${divisor} equal groups.`, 'Long division: divide, multiply, subtract, bring down.', [`${a} ÷ ${divisor} = ${q}.`], `${q} × ${divisor} = ${a} ✓`),
      explanation: `${a} ÷ ${divisor} = ${q}, because ${divisor} × ${q} = ${a}.`, verify: { kind: 'numeric', expr: `${a}/${divisor}` },
    };
    return {
      prompt: `${a} ÷ ${divisor} = ?  (write as quotient R remainder, e.g. 12 R3)`, answerType: 'text', answer: `${q} R${rem}`, accept: [`${q}r${rem}`],
      hints: [`How many full groups of ${divisor} fit into ${a}?`, 'The remainder is what is left after making as many full groups as possible.', `${divisor} × ${q} = ${divisor * q}. What is left?`],
      steps: frame(`Divide ${a} by ${divisor}.`, 'Find the biggest multiple of the divisor that fits, then the remainder.', [`${divisor} × ${q} = ${divisor * q}`, `${a} − ${divisor * q} = ${rem}`], `${divisor} × ${q} + ${rem} = ${a} ✓, and ${rem} < ${divisor} ✓`),
      explanation: `${a} ÷ ${divisor} = ${q} R${rem}.`, verify: { kind: 'numeric', expr: `${divisor}*${q}+${rem}-${a}` },
    };
  },
  'order-ops': (r, d) => {
    const a = ri(r, 2, 12), b = ri(r, 2, 9), c = ri(r, 2, 9), e = ri(r, 1, 5);
    const forms: [string, string, number, number][] = [
      [`${a} + ${b} × ${c}`, `${a}+${b}*${c}`, a + b * c, (a + b) * c],
      [`(${a} + ${b}) × ${c}`, `(${a}+${b})*${c}`, (a + b) * c, a + b * c],
      [`${a * c} ÷ ${c} + ${b} × ${e}`, `${a * c}/${c}+${b}*${e}`, a + b * e, (a + b) * e],
      [`${a} + ${b}² × ${e}`, `${a}+${b}^2*${e}`, a + b * b * e, (a + b) ** 2 * e],
      [`${a * 2} − ${b} × (${c} − ${e > c ? c : e})`, `${a * 2}-${b}*(${c}-${e > c ? c : e})`, a * 2 - b * (c - Math.min(e, c)), (a * 2 - b) * (c - Math.min(e, c))],
    ];
    const [show, math, ans, wrong] = forms[Math.min(forms.length - 1, ri(r, 0, Math.min(4, d)))];
    return {
      prompt: `Evaluate: ${show}`, answerType: 'number', answer: n(ans),
      hints: ['Which operation comes first?', 'Order: Brackets, Exponents, × and ÷ (left to right), then + and − (left to right).', 'Do any brackets and exponents first, then multiplication.'],
      steps: frame(`Evaluate ${show}.`, 'Follow the order of operations (BEDMAS/PEMDAS).', [`Result: ${ans}.`], 'Each operation was done in the correct order ✓'),
      explanation: `${show} = ${ans}. Multiplication/division happen before addition/subtraction unless brackets say otherwise.`,
      verify: { kind: 'numeric', expr: math },
      mistakes: wrong !== ans ? [{ answer: n(wrong), type: 'left-to-right', message: 'It looks like the operations were done left to right. Remember × and ÷ come before + and − (unless there are brackets).' }] : [],
    };
  },
  negatives: (r, d) => {
    const a = ri(r, 1, 5 + d * 3), b = ri(r, 1, 5 + d * 3);
    const forms: [string, string, number, number | null, string][] = [
      [`−${a} + ${b}`, `-${a}+${b}`, -a + b, a + b, 'Start at −a on the number line and move right.'],
      [`${a} − (−${b})`, `${a}-(-${b})`, a + b, a - b, 'Subtracting a negative is the same as adding a positive.'],
      [`−${a} − ${b}`, `-${a}-${b}`, -a - b, -a + b, 'Start below zero and move further left.'],
      [`(−${a}) × ${b}`, `(-${a})*${b}`, -a * b, a * b, 'A negative times a positive is negative.'],
      [`(−${a}) × (−${b})`, `(-${a})*(-${b})`, a * b, -a * b, 'A negative times a negative is positive.'],
    ];
    const [show, math, ans, wrong, rule] = forms[ri(r, 0, Math.min(4, d))];
    return {
      prompt: `${show} = ?`, answerType: 'number', answer: n(ans), visual: Math.abs(ans) <= 20 ? { type: 'number-line', min: -20, max: 20, highlight: ans } : undefined,
      hints: ['Think about the number line.', rule, 'Decide the sign first, then the size.'],
      steps: frame(`Evaluate ${show}.`, rule, [`${show} = ${ans}`], 'Check the sign makes sense on the number line ✓'),
      explanation: `${show} = ${ans}. ${rule}`, verify: { kind: 'numeric', expr: math },
      mistakes: wrong !== null && wrong !== ans ? [{ answer: n(wrong), type: 'sign-error', message: 'The size is right but check the sign. ' + rule }] : [],
    };
  },
  'primes-factors': (r, d) => {
    const g = pick(r, d <= 2 ? [2, 3, 4, 5, 6] : [4, 6, 8, 9, 12, 15]); let m = ri(r, 2, 7), k = ri(r, 2, 9);
    while (gcd(m, k) !== 1 || m === k) k = ri(r, 2, 9);
    const a = g * m, b = g * k; const askLcm = d >= 3 && r() < 0.5; const ans = askLcm ? lcm(a, b) : g;
    return {
      prompt: `What is the ${askLcm ? 'least common multiple (LCM)' : 'greatest common factor (GCF)'} of ${a} and ${b}?`, answerType: 'number', answer: n(ans),
      hints: askLcm ? [`List multiples of ${Math.max(a, b)} until one is divisible by ${Math.min(a, b)}.`, 'LCM = (a × b) ÷ GCF.', `GCF(${a}, ${b}) = ${g}.`] : ['List the factors of each number.', 'The GCF is the largest number that divides both exactly.', `Does ${g} divide both ${a} and ${b}?`],
      steps: frame(`Find the ${askLcm ? 'LCM' : 'GCF'} of ${a} and ${b}.`, askLcm ? 'Use LCM = a × b ÷ GCF.' : 'Compare factor lists or prime factorizations.', askLcm ? [`GCF = ${g}`, `LCM = ${a} × ${b} ÷ ${g} = ${ans}`] : [`${a} = ${g} × ${m}, ${b} = ${g} × ${k}`, `${m} and ${k} share no common factor, so GCF = ${g}`], askLcm ? `${ans} ÷ ${a} = ${ans / a}, ${ans} ÷ ${b} = ${ans / b} ✓` : `${a} ÷ ${g} = ${m}, ${b} ÷ ${g} = ${k} ✓`),
      explanation: `The ${askLcm ? 'LCM' : 'GCF'} of ${a} and ${b} is ${ans}.`, verify: { kind: 'numeric', expr: askLcm ? `lcm(${a},${b})` : `gcd(${a},${b})` },
      mistakes: askLcm ? [{ answer: n(a * b), type: 'product-not-lcm', message: `${a * b} is a common multiple, but is it the least?` }] : [{ answer: n(Math.min(a, b) === g ? 1 : g / 2), type: 'not-greatest', message: 'That is a common factor — is there a bigger one?' }],
    };
  },
  exponents: (r, d) => {
    const base = ri(r, 2, Math.min(10, 2 + d * 2)); let p = ri(r, 2, d <= 2 ? 3 : 5); while (base ** p > 100000) p--;
    const zero = d >= 3 && r() < 0.2;
    if (zero) return {
      prompt: `${base}⁰ = ?`, answerType: 'number', answer: '1', hints: ['Look at the pattern: 2³ = 8, 2² = 4, 2¹ = 2, 2⁰ = ?', 'Each step down divides by the base.', 'Any non-zero number to the power 0 equals 1.'],
      steps: frame('Evaluate a power of zero.', 'Use the pattern of dividing by the base.', [`${base}¹ ÷ ${base} = 1`], 'Matches the rule a⁰ = 1 ✓'),
      explanation: 'Any non-zero number to the power 0 is 1.', verify: { kind: 'numeric', expr: `${base}^0` }, mistakes: [{ answer: '0', type: 'zero-power', message: 'A common idea! But a⁰ = 1, not 0. Look at the pattern of dividing by the base.' }],
    };
    return {
      prompt: `${base}${['', '', '²', '³', '⁴', '⁵'][p]} = ?`, answerType: 'number', answer: n(base ** p),
      hints: [`Multiply ${base} by itself ${p} times.`, 'An exponent means repeated multiplication, not multiplication by the exponent.', `${base} × ${base} = ${base * base}.`],
      steps: frame(`Evaluate ${base} to the power ${p}.`, 'Write it as repeated multiplication.', [`${Array(p).fill(base).join(' × ')} = ${base ** p}`], `Check: ${base ** p} ÷ ${base} = ${base ** (p - 1)} = ${base}^${p - 1} ✓`),
      explanation: `${base}^${p} means ${Array(p).fill(base).join(' × ')} = ${base ** p}.`, verify: { kind: 'numeric', expr: `${base}^${p}` },
      mistakes: [{ answer: n(base * p), type: 'multiplied-exponent', message: `That’s ${base} × ${p}. An exponent means multiply ${base} by itself ${p} times.` }],
    };
  },
  'square-roots': (r, d) => {
    if (d <= 3) {
      const k = ri(r, 2, d <= 1 ? 10 : d === 2 ? 15 : 25);
      return {
        prompt: `√${k * k} = ?`, answerType: 'number', answer: n(k), hints: ['What number times itself gives this?', 'A square root undoes squaring.', `Try ${k - 1}² = ${(k - 1) ** 2} and ${k + 1}² = ${(k + 1) ** 2}.`],
        steps: frame(`Find the number whose square is ${k * k}.`, 'Think of square numbers.', [`${k} × ${k} = ${k * k}`], `${k}² = ${k * k} ✓`), explanation: `√${k * k} = ${k} because ${k}² = ${k * k}.`, verify: { kind: 'numeric', expr: `sqrt(${k * k})` },
        mistakes: [{ answer: n((k * k) / 2), type: 'halved', message: 'Square root is not the same as dividing by 2. What number times ITSELF gives this?' }],
      };
    }
    let m = ri(r, 10, 200); while (Number.isInteger(Math.sqrt(m))) m++;
    return {
      prompt: `Estimate √${m} to 2 decimal places.`, answerType: 'number', answer: n(round(Math.sqrt(m), 2)), tolerance: 0.011,
      hints: ['Which perfect squares is it between?', `√${Math.floor(Math.sqrt(m)) ** 2} = ${Math.floor(Math.sqrt(m))} and √${Math.ceil(Math.sqrt(m)) ** 2} = ${Math.ceil(Math.sqrt(m))}.`, 'Use a calculator or refine your estimate by squaring decimals.'],
      steps: frame(`Approximate √${m}.`, 'Bracket between perfect squares, then refine.', [`${Math.floor(Math.sqrt(m))}² < ${m} < ${Math.ceil(Math.sqrt(m))}²`, `√${m} ≈ ${round(Math.sqrt(m), 2)}`], `${round(Math.sqrt(m), 2)}² ≈ ${round(Math.sqrt(m) ** 2, 1)} ✓`),
      explanation: `√${m} ≈ ${round(Math.sqrt(m), 2)}.`, verify: { kind: 'numeric', expr: `sqrt(${m})` },
    };
  },
  'sci-notation': (r, d) => {
    const mant = ri(r, 11, 99) / 10; const p = d >= 3 && r() < 0.5 ? -ri(r, 2, 5) : ri(r, 3, 8);
    const value = mant * 10 ** p; const valueStr = p < 0 ? value.toFixed(-p + 1).replace(/0+$/, '') : Math.round(value).toLocaleString('en-US');
    if (d <= 2) return {
      prompt: `${valueStr} = ${mant} × 10ⁿ. What is n?`, answerType: 'number', answer: n(p),
      hints: ['Count how many places the decimal point moves.', 'Big numbers have positive powers, small numbers negative.', `Move the decimal from ${mant} until you get ${valueStr}.`],
      steps: frame('Find the power of 10.', 'Count decimal moves.', [`The decimal moves ${Math.abs(p)} places ${p > 0 ? 'right' : 'left'}, so n = ${p}.`], `${mant} × 10^${p} = ${valueStr} ✓`), explanation: `n = ${p}.`, verify: { kind: 'numeric', expr: `log10(${value}/${mant})` },
    };
    const sup = (k: number) => String(k).replace('-', '⁻').replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]);
    const correct = `${mant} × 10${sup(p)}`;
    return {
      prompt: `Write ${valueStr} in scientific notation.`, answerType: 'choice', answer: correct, choices: choices(r, correct, [`${mant} × 10${sup(p + 1)}`, `${mant} × 10${sup(p - 1)}`, `${mant * 10} × 10${sup(p - 1)}`, `${mant} × 10${sup(-p)}`]),
      hints: ['The first number must be between 1 and 10.', 'Count the places the decimal point moves.', p < 0 ? 'Small numbers get a negative exponent.' : 'Large numbers get a positive exponent.'],
      steps: frame('Rewrite as a × 10ⁿ with 1 ≤ a < 10.', 'Move the decimal after the first non-zero digit.', [`a = ${mant}; moved ${Math.abs(p)} places → n = ${p}`], `${correct} = ${valueStr} ✓`),
      explanation: `${valueStr} = ${correct}.`, verify: { kind: 'choice' },
    };
  },

  // ───────────────────────── FRACTIONS & DECIMALS
  'frac-intro': (r, d) => {
    const parts = ri(r, 2, Math.min(12, 3 + d * 2)); const shaded = ri(r, 1, parts - 1);
    return {
      prompt: 'What fraction of the shape is shaded?', answerType: 'fraction', answer: `${shaded}/${parts}`,
      visual: r() < 0.5 ? { type: 'fraction-bar', parts, shaded } : { type: 'fraction-circle', parts, shaded },
      hints: ['Count all the equal parts — that’s the bottom number.', 'The denominator is the total number of equal parts; the numerator is how many are shaded.', `There are ${parts} parts in total.`],
      steps: frame('Describe the shaded part as a fraction.', 'Count total parts (denominator) and shaded parts (numerator).', [`Total parts: ${parts}`, `Shaded: ${shaded}`, `Fraction: ${shaded}/${parts}`], 'The parts are equal in size, so a fraction describes it ✓'),
      explanation: `${shaded} out of ${parts} equal parts are shaded, so the fraction is ${shaded}/${parts}.`, verify: { kind: 'numeric', expr: `${shaded}/${parts}` },
      mistakes: [{ answer: `${parts}/${shaded}`, type: 'upside-down', message: 'The fraction is upside down. The bottom number is the total number of parts.' }, { answer: `${shaded}/${parts - shaded}`, type: 'part-to-part', message: 'You compared shaded to unshaded. The bottom should be ALL the parts.' }],
    };
  },
  'frac-equiv': (r, d) => {
    let a = ri(r, 1, 7), b = ri(r, a + 1, 12); while (gcd(a, b) !== 1) b = ri(r, a + 1, 12);
    const k = ri(r, 2, d <= 2 ? 4 : 8);
    if (r() < 0.5) return {
      prompt: `Simplify ${a * k}/${b * k} to lowest terms.`, answerType: 'fraction', answer: `${a}/${b}`, requireSimplest: true,
      hints: ['Find a number that divides both the top and bottom.', 'Divide numerator and denominator by their greatest common factor.', `Both ${a * k} and ${b * k} are divisible by ${k}.`],
      steps: frame(`Write ${a * k}/${b * k} in simplest form.`, 'Divide top and bottom by the GCF.', [`GCF(${a * k}, ${b * k}) = ${k}`, `${a * k} ÷ ${k} = ${a}, ${b * k} ÷ ${k} = ${b}`], `${a} and ${b} share no factors except 1 ✓`),
      explanation: `${a * k}/${b * k} = ${a}/${b}.`, verify: { kind: 'numeric', expr: `${a * k}/${b * k}` },
    };
    return {
      prompt: `Fill in the blank: ${a}/${b} = ?/${b * k}`, answerType: 'number', answer: n(a * k),
      hints: [`What did ${b} get multiplied by to make ${b * k}?`, 'Multiply the top and bottom by the same number.', `${b} × ${k} = ${b * k}.`],
      steps: frame('Find an equivalent fraction.', 'Multiply top and bottom by the same number.', [`${b} × ${k} = ${b * k}`, `${a} × ${k} = ${a * k}`], `${a * k}/${b * k} simplifies back to ${a}/${b} ✓`),
      explanation: `${a}/${b} = ${a * k}/${b * k}.`, verify: { kind: 'numeric', expr: `${a}*${b * k}/${b}` },
      mistakes: [{ answer: n(a + (b * k - b)), type: 'added-not-multiplied', message: 'It looks like you added instead of multiplying. Equivalent fractions multiply top and bottom by the same number.' }],
    };
  },
  'frac-add-like': (r, d) => {
    const den = ri(r, 3, 12); const a = ri(r, 1, den - 1); const sub = d >= 3 && r() < 0.5; const b = sub ? ri(r, 1, a) : ri(r, 1, den);
    const num = sub ? a - b : a + b;
    return {
      prompt: `${a}/${den} ${sub ? '−' : '+'} ${b}/${den} = ?  (simplify if possible)`, answerType: 'fraction', answer: frac(num, den), requireSimplest: d >= 3,
      visual: !sub && num <= den ? { type: 'fraction-bar', parts: den, shaded: num } : undefined,
      hints: ['The pieces are the same size, so only the number of pieces changes.', 'Keep the denominator; add or subtract the numerators.', `${a} ${sub ? '−' : '+'} ${b} = ${num}.`],
      steps: frame(`${sub ? 'Subtract' : 'Add'} fractions with the same denominator.`, 'Keep the denominator, combine numerators.', [`${a} ${sub ? '−' : '+'} ${b} = ${num}`, `= ${num}/${den} = ${frac(num, den)}`], 'Denominator stayed the same because the piece size didn’t change ✓'),
      explanation: `${a}/${den} ${sub ? '−' : '+'} ${b}/${den} = ${frac(num, den)}.`, verify: { kind: 'numeric', expr: `${a}/${den}${sub ? '-' : '+'}${b}/${den}` },
      mistakes: [{ answer: frac(num, den * 2), type: 'added-denominators', message: 'It looks like the denominators were added too. The piece size stays the same — only add the numerators.' }],
    };
  },
  'frac-add-unlike': (r, d) => {
    const dens = d <= 2 ? [2, 3, 4, 5, 6] : [2, 3, 4, 5, 6, 8, 9, 10, 12];
    const m = pick(r, dens); let k = pick(r, dens); while (k === m) k = pick(r, dens);
    const a = ri(r, 1, m - 1), b = ri(r, 1, k - 1); const sub = d >= 3 && r() < 0.4 && a / m > b / k; const L = lcm(m, k);
    const num = sub ? a * (L / m) - b * (L / k) : a * (L / m) + b * (L / k);
    return {
      prompt: `${a}/${m} ${sub ? '−' : '+'} ${b}/${k} = ?  (give your answer in simplest form)`, answerType: 'fraction', answer: frac(num, L), requireSimplest: true,
      hints: ['Can you add pieces of different sizes directly?', 'Rewrite both fractions with a common denominator (the LCM of the denominators).', `The LCM of ${m} and ${k} is ${L}.`],
      steps: frame(`${sub ? 'Subtract' : 'Add'} ${a}/${m} and ${b}/${k}.`, 'Use a common denominator.', [`LCM(${m}, ${k}) = ${L}`, `${a}/${m} = ${a * (L / m)}/${L}, ${b}/${k} = ${b * (L / k)}/${L}`, `${a * (L / m)} ${sub ? '−' : '+'} ${b * (L / k)} = ${num} → ${num}/${L} = ${frac(num, L)}`], `${frac(num, L)} ≈ ${n(round(num / L, 3))}, and ${n(round(a / m, 3))} ${sub ? '−' : '+'} ${n(round(b / k, 3))} ≈ ${n(round(num / L, 3))} ✓`),
      explanation: `${a}/${m} ${sub ? '−' : '+'} ${b}/${k} = ${frac(num, L)}. We needed a common denominator so the pieces were the same size.`, verify: { kind: 'numeric', expr: `${a}/${m}${sub ? '-' : '+'}${b}/${k}` },
      mistakes: sub ? [] : [{ answer: frac(a + b, m + k), type: 'added-denominators', message: 'You added the tops and the bottoms. The pieces are different sizes — first find a common denominator.' }],
    };
  },
  'frac-mult': (r, d) => {
    const a = ri(r, 1, 7), b = ri(r, a + 1, 9), c = ri(r, 1, 7), e = ri(r, c + 1, 10); const whole = d >= 4 && r() < 0.5;
    if (whole) {
      const w = ri(r, 2, 12);
      return {
        prompt: `What is ${a}/${b} of ${w * b}?`, answerType: 'number', answer: n(a * w), hints: ['"Of" means multiply.', `Find 1/${b} of ${w * b} first.`, `${w * b} ÷ ${b} = ${w}.`],
        steps: frame(`Find ${a}/${b} of ${w * b}.`, 'Divide by the denominator, multiply by the numerator.', [`${w * b} ÷ ${b} = ${w}`, `${w} × ${a} = ${a * w}`], `${a * w} is less than ${w * b} because ${a}/${b} < 1 ✓`),
        explanation: `${a}/${b} of ${w * b} = ${a * w}.`, verify: { kind: 'numeric', expr: `${a}/${b}*${w * b}` },
      };
    }
    return {
      prompt: `${a}/${b} × ${c}/${e} = ?  (simplest form)`, answerType: 'fraction', answer: frac(a * c, b * e), requireSimplest: true,
      hints: ['Multiply the numerators together and the denominators together.', 'a/b × c/d = (a×c)/(b×d). Then simplify.', `Top: ${a} × ${c} = ${a * c}.`],
      steps: frame(`Multiply ${a}/${b} by ${c}/${e}.`, 'Multiply straight across, then simplify.', [`${a} × ${c} = ${a * c}`, `${b} × ${e} = ${b * e}`, `${a * c}/${b * e} = ${frac(a * c, b * e)}`], 'The answer is smaller than both fractions, which makes sense for taking a part of a part ✓'),
      explanation: `${a}/${b} × ${c}/${e} = ${frac(a * c, b * e)}.`, verify: { kind: 'numeric', expr: `${a}/${b}*${c}/${e}` },
      mistakes: [{ answer: frac(a * e + c * b, b * e), type: 'added', message: 'It looks like the fractions were added. For multiplication, multiply straight across.' }],
    };
  },
  'frac-div': (r) => {
    const a = ri(r, 1, 7), b = ri(r, 2, 9), c = ri(r, 1, 7), e = ri(r, 2, 9);
    return {
      prompt: `${a}/${b} ÷ ${c}/${e} = ?  (simplest form)`, answerType: 'fraction', answer: frac(a * e, b * c), requireSimplest: true,
      hints: ['How many of the second fraction fit into the first?', 'Keep, change, flip: multiply by the reciprocal of the second fraction.', `The reciprocal of ${c}/${e} is ${e}/${c}.`],
      steps: frame(`Divide ${a}/${b} by ${c}/${e}.`, 'Multiply by the reciprocal.', [`${a}/${b} × ${e}/${c}`, `= ${a * e}/${b * c} = ${frac(a * e, b * c)}`], `Check: ${frac(a * e, b * c)} × ${c}/${e} = ${frac(a, b)} ✓`),
      explanation: `${a}/${b} ÷ ${c}/${e} = ${frac(a * e, b * c)}.`, verify: { kind: 'numeric', expr: `(${a}/${b})/(${c}/${e})` },
      mistakes: [{ answer: frac(a * c, b * e), type: 'no-flip', message: 'It looks like you multiplied without flipping. Dividing means multiplying by the reciprocal.' }],
    };
  },
  decimals: (r, d) => {
    const a = ri(r, 100, 999) / 100, b = ri(r, 10, d >= 3 ? 999 : 99) / (d >= 3 ? 100 : 10); const sub = r() < 0.5 && a > b;
    const ans = round(sub ? a - b : a + b, 2);
    return {
      prompt: `${n(a)} ${sub ? '−' : '+'} ${n(b)} = ?`, answerType: 'number', answer: n(ans),
      hints: ['Line up the decimal points.', 'Add zeros so both numbers have the same number of decimal places.', `${n(b)} = ${b.toFixed(2)}.`],
      steps: frame(`${sub ? 'Subtract' : 'Add'} decimals.`, 'Line up decimal points and work by place value.', [`${a.toFixed(2)} ${sub ? '−' : '+'} ${b.toFixed(2)} = ${ans.toFixed(2)}`], `Estimate: ${Math.round(a)} ${sub ? '−' : '+'} ${Math.round(b)} = ${sub ? Math.round(a) - Math.round(b) : Math.round(a) + Math.round(b)} ≈ ${n(ans)} ✓`),
      explanation: `${n(a)} ${sub ? '−' : '+'} ${n(b)} = ${n(ans)}.`, verify: { kind: 'numeric', expr: `${a}${sub ? '-' : '+'}${b}` },
    };
  },
  'dec-mult': (r, d) => {
    const a = ri(r, 2, 99) / 10, b = ri(r, 2, d >= 3 ? 99 : 9) / 10; const div = d >= 4 && r() < 0.5;
    if (div) {
      const q = ri(r, 2, 40) / 10; const dv = ri(r, 2, 9) / 10; const t = round(q * dv, 2);
      return {
        prompt: `${n(t)} ÷ ${n(dv)} = ?`, answerType: 'number', answer: n(q), hints: ['Make the divisor a whole number.', `Multiply both numbers by 10: ${n(t * 10)} ÷ ${n(dv * 10)}.`, 'Then divide as usual.'],
        steps: frame('Divide by a decimal.', 'Scale both numbers by 10.', [`${n(round(t * 10, 2))} ÷ ${n(round(dv * 10, 2))} = ${n(q)}`], `${n(q)} × ${n(dv)} = ${n(t)} ✓`), explanation: `${n(t)} ÷ ${n(dv)} = ${n(q)}.`, verify: { kind: 'numeric', expr: `${t}/${dv}` },
      };
    }
    const ans = round(a * b, 4);
    return {
      prompt: `${n(a)} × ${n(b)} = ?`, answerType: 'number', answer: n(ans),
      hints: ['Multiply as if there were no decimal points.', 'Count the total decimal places in both numbers; the answer has that many.', `${Math.round(a * 10)} × ${Math.round(b * 10)} = ${Math.round(a * 10) * Math.round(b * 10)}.`],
      steps: frame('Multiply decimals.', 'Multiply whole numbers, then place the decimal.', [`${Math.round(a * 10)} × ${Math.round(b * 10)} = ${Math.round(a * 10) * Math.round(b * 10)}`, `2 decimal places → ${n(ans)}`], `Estimate ${Math.round(a)} × ${Math.round(b)} ≈ ${Math.round(a) * Math.round(b)} ✓`),
      explanation: `${n(a)} × ${n(b)} = ${n(ans)}.`, verify: { kind: 'numeric', expr: `${a}*${b}` },
      mistakes: [{ answer: n(round(a * b * 10, 4)), type: 'decimal-place', message: 'The digits are right — check where the decimal point goes.' }],
    };
  },
  'frac-dec-convert': (r) => {
    const opts: [number, number][] = [[1, 2], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5], [1, 8], [3, 8], [5, 8], [7, 10], [3, 20], [9, 25], [1, 10]];
    const [a, b] = pick(r, opts); const mode = ri(r, 0, 2); const dec = a / b;
    if (mode === 0) return { prompt: `Write ${a}/${b} as a decimal.`, answerType: 'number', answer: n(dec), hints: ['A fraction bar means divide.', `Divide ${a} by ${b}.`, `Or make the denominator 10, 100 or 1000.`], steps: frame(`Convert ${a}/${b}.`, 'Divide numerator by denominator.', [`${a} ÷ ${b} = ${n(dec)}`], `${n(dec)} × ${b} = ${a} ✓`), explanation: `${a}/${b} = ${n(dec)}.`, verify: { kind: 'numeric', expr: `${a}/${b}` } };
    if (mode === 1) return { prompt: `Write ${a}/${b} as a percent.`, answerType: 'number', unit: '%', answer: n(round(dec * 100, 2)), hints: ['First convert to a decimal.', 'Percent means "per hundred": multiply the decimal by 100.', `${a}/${b} = ${n(dec)}.`], steps: frame(`Convert ${a}/${b} to a percent.`, 'Fraction → decimal → percent.', [`${a} ÷ ${b} = ${n(dec)}`, `${n(dec)} × 100 = ${n(round(dec * 100, 2))}%`], 'Percent value is between 0 and 100 because the fraction is less than 1 ✓'), explanation: `${a}/${b} = ${n(round(dec * 100, 2))}%.`, verify: { kind: 'numeric', expr: `${a}/${b}*100` }, mistakes: [{ answer: n(dec), type: 'forgot-100', message: 'That is the decimal. Multiply by 100 to get a percent.' }] };
    return { prompt: `Write ${n(dec)} as a fraction in simplest form.`, answerType: 'fraction', answer: frac(a, b), requireSimplest: true, hints: ['Read the decimal place value aloud (tenths, hundredths…).', `${n(dec)} = ${Math.round(dec * 1000)}/1000.`, 'Then simplify by dividing by the GCF.'], steps: frame(`Convert ${n(dec)} to a fraction.`, 'Use place value, then simplify.', [`${n(dec)} = ${Math.round(dec * 1000)}/1000 = ${frac(a, b)}`], `${a} ÷ ${b} = ${n(dec)} ✓`), explanation: `${n(dec)} = ${frac(a, b)}.`, verify: { kind: 'numeric', expr: `${a}/${b}` } };
  },

  // ───────────────────────── RATIOS & PERCENT
  ratios: (r, d) => {
    const a = ri(r, 1, 5), b = ri(r, 1, 7); const unitV = ri(r, 2, d <= 2 ? 6 : 15); const total = (a + b) * unitV; const name = pick(r, ['Sam and Lee', 'Ava and Omar', 'Mia and Raj']);
    const [p1, p2] = name.split(' and ');
    return {
      prompt: `${name} share $${total} in the ratio ${a} : ${b}. How much does ${p2} get?`, answerType: 'number', unit: '$', answer: n(b * unitV),
      hints: ['How many parts are there in total?', 'Total parts = sum of the ratio numbers. Find the value of one part.', `${a} + ${b} = ${a + b} parts; one part = ${total} ÷ ${a + b}.`],
      steps: frame(`Split $${total} in ratio ${a} : ${b}.`, 'Find the value of one part.', [`Total parts: ${a + b}`, `One part: ${total} ÷ ${a + b} = ${unitV}`, `${p2}: ${b} × ${unitV} = ${b * unitV}`], `${p1} gets ${a * unitV}; ${a * unitV} + ${b * unitV} = ${total} ✓`),
      explanation: `${p2} gets $${b * unitV}.`, verify: { kind: 'numeric', expr: `${total}*${b}/(${a}+${b})` },
      mistakes: [{ answer: n(total / b), type: 'divided-by-part', message: 'Remember to divide by the TOTAL number of parts first.' }],
    };
  },
  'unit-rate': (r, d) => {
    const qty = ri(r, 2, 12); const each = d <= 2 ? ri(r, 1, 9) : ri(r, 50, 499) / 100; const price = round(qty * each, 2); const item = pick(r, ['notebooks', 'apples', 'bus tickets', 'pens']);
    return {
      prompt: `${qty} ${item} cost $${price.toFixed(2)}. What is the cost of one?`, answerType: 'number', unit: '$', answer: n(round(each, 2)),
      hints: ['"Per one" means divide.', 'Unit rate = total ÷ number of units.', `${price.toFixed(2)} ÷ ${qty}.`],
      steps: frame('Find the price per item.', 'Divide total cost by quantity.', [`${price.toFixed(2)} ÷ ${qty} = ${each.toFixed(2)}`], `${each.toFixed(2)} × ${qty} = ${price.toFixed(2)} ✓`),
      explanation: `Each costs $${each.toFixed(2)}.`, verify: { kind: 'numeric', expr: `${price}/${qty}` }, context: 'shopping',
    };
  },
  'percent-of': (r, d) => {
    const p = pick(r, d <= 2 ? [10, 20, 25, 50, 75] : [5, 12.5, 15, 30, 35, 40, 60, 2.5]); const base = ri(r, 2, 40) * (d <= 2 ? 10 : 20);
    const ans = round((p / 100) * base, 2);
    return {
      prompt: `What is ${p}% of ${base}?`, answerType: 'number', answer: n(ans),
      hints: ['Percent means per hundred.', `Change ${p}% to a decimal (${p / 100}) and multiply.`, `10% of ${base} is ${base / 10}.`],
      steps: frame(`Find ${p}% of ${base}.`, 'Convert the percent to a decimal and multiply.', [`${p}% = ${p / 100}`, `${p / 100} × ${base} = ${n(ans)}`], `${p}% is ${p < 50 ? 'less' : 'more'} than half, and ${n(ans)} is ${p < 50 ? 'less' : 'more'} than ${base / 2} ✓`),
      explanation: `${p}% of ${base} = ${n(ans)}.`, verify: { kind: 'numeric', expr: `${p}/100*${base}` },
      mistakes: [{ answer: n(p * base), type: 'forgot-100', message: 'Remember to divide the percent by 100 first.' }],
    };
  },
  'percent-change': (r) => {
    const old = ri(r, 2, 20) * 10; const pct = pick(r, [5, 10, 15, 20, 25, 30, 40, 50, 60]); const up = r() < 0.5; const nw = old * (1 + (up ? pct : -pct) / 100);
    return {
      prompt: `A price changes from $${old} to $${n(nw)}. What is the percent ${up ? 'increase' : 'decrease'}?`, answerType: 'number', unit: '%', answer: n(pct),
      hints: ['First find the amount of change.', 'Percent change = change ÷ ORIGINAL × 100.', `The change is ${n(Math.abs(nw - old))}.`],
      steps: frame(`Compare $${old} → $${n(nw)}.`, 'Divide the change by the original value.', [`Change: ${n(Math.abs(nw - old))}`, `${n(Math.abs(nw - old))} ÷ ${old} = ${pct / 100}`, `× 100 = ${pct}%`], `${old} × ${up ? 1 + pct / 100 : 1 - pct / 100} = ${n(nw)} ✓`),
      explanation: `The ${up ? 'increase' : 'decrease'} is ${pct}%.`, verify: { kind: 'numeric', expr: `abs(${nw}-${old})/${old}*100` },
      mistakes: [{ answer: n(round((Math.abs(nw - old) / nw) * 100, 2)), type: 'divided-by-new', message: 'You divided by the new value. Percent change always compares to the ORIGINAL value.' }],
    };
  },
  proportions: (r) => {
    const a = ri(r, 1, 9), b = ri(r, a + 1, 12), k = ri(r, 2, 9);
    return {
      prompt: `Solve for x: ${a}/${b} = x/${b * k}`, answerType: 'number', answer: n(a * k), variable: 'x',
      hints: ['The two ratios are equal.', 'Cross-multiply: a·d = b·c.', `${b} · x = ${a} · ${b * k}.`],
      steps: frame('Solve the proportion.', 'Cross-multiply and divide.', [`${b}x = ${a * b * k}`, `x = ${a * b * k} ÷ ${b} = ${a * k}`], `${a * k}/${b * k} simplifies to ${frac(a, b)} ✓`),
      explanation: `x = ${a * k}.`, verify: { kind: 'equation', eq: `${a}/${b} = x/${b * k}`, variable: 'x' },
    };
  },

  // ───────────────────────── MENTAL MATH
  'mental-add': (r, d) => {
    const a = ri(r, 1, 9) * 10 + pick(r, [7, 8, 9]); const b = ri(r, 11, d >= 3 ? 199 : 69); const sub = d >= 3 && r() < 0.5 && b < a;
    const ans = sub ? a - b : a + b; const roundA = Math.ceil(a / 10) * 10;
    return {
      prompt: `Mental math: ${a} ${sub ? '−' : '+'} ${b}`, answerType: 'number', answer: n(ans),
      hints: [`Round ${a} to ${roundA}.`, 'Round to a friendly number, compute, then adjust.', `${roundA} ${sub ? '−' : '+'} ${b} = ${sub ? roundA - b : roundA + b}, then adjust by ${roundA - a}.`],
      steps: frame('Compute in your head.', 'Compensation strategy.', [`${roundA} ${sub ? '−' : '+'} ${b} = ${sub ? roundA - b : roundA + b}`, `Adjust ${sub ? '+' : '−'}${roundA - a}: ${ans}`], 'Estimate check ✓'),
      explanation: `${a} ${sub ? '−' : '+'} ${b} = ${ans}.`, verify: { kind: 'numeric', expr: `${a}${sub ? '-' : '+'}${b}` },
    };
  },
  'mental-mult': (r, d) => {
    const kind = ri(r, 0, d >= 3 ? 2 : 1);
    if (kind === 0) { const k = ri(r, 2, 40) * 2; return { prompt: `Mental math: 25 × ${k}`, answerType: 'number', answer: n(25 * k), hints: ['25 is a quarter of 100.', 'Double and halve: 25 × k = 50 × (k ÷ 2).', `${k} ÷ 4 = ${k / 4}, then × 100.`], steps: frame(`25 × ${k}`, 'Use 25 = 100 ÷ 4.', [`${k} ÷ 4 × 100 = ${25 * k}`], 'Check with doubling ✓'), explanation: `25 × ${k} = ${25 * k}.`, verify: { kind: 'numeric', expr: `25*${k}` } }; }
    if (kind === 1) { const a = ri(r, 12, 19), b = ri(r, 3, 9); return { prompt: `Mental math: ${a} × ${b}`, answerType: 'number', answer: n(a * b), hints: [`Split ${a} = 10 + ${a - 10}.`, 'Multiply each part and add.', `10 × ${b} = ${10 * b}; ${a - 10} × ${b} = ${(a - 10) * b}.`], steps: frame(`${a} × ${b}`, 'Split into tens and ones.', [`${10 * b} + ${(a - 10) * b} = ${a * b}`], '✓'), explanation: `${a} × ${b} = ${a * b}.`, verify: { kind: 'numeric', expr: `${a}*${b}` } }; }
    const a = ri(r, 11, 99); return { prompt: `Mental math: 11 × ${a}`, answerType: 'number', answer: n(11 * a), hints: ['11 × n = 10n + n.', `10 × ${a} = ${10 * a}.`, `Add ${a}.`], steps: frame(`11 × ${a}`, '11 = 10 + 1.', [`${10 * a} + ${a} = ${11 * a}`], '✓'), explanation: `11 × ${a} = ${11 * a}.`, verify: { kind: 'numeric', expr: `11*${a}` } };
  },
  'mental-percent': (r) => {
    const p = pick(r, [10, 5, 15, 20, 1, 25]); const base = ri(r, 2, 30) * 20;
    return {
      prompt: `Mental math: ${p}% of ${base}`, answerType: 'number', answer: n((p * base) / 100),
      hints: ['Start with 10%: move the decimal one place left.', '5% is half of 10%; 15% = 10% + 5%; 20% = 2 × 10%.', `10% of ${base} = ${base / 10}.`],
      steps: frame(`${p}% of ${base}`, 'Build from 10%.', [`10% = ${base / 10}`, `${p}% = ${n((p * base) / 100)}`], '✓'), explanation: `${p}% of ${base} = ${n((p * base) / 100)}.`, verify: { kind: 'numeric', expr: `${p}*${base}/100` },
    };
  },
  'mental-squares': (r, d) => {
    const end5 = r() < 0.5; const k = end5 ? ri(r, 1, d >= 3 ? 12 : 9) * 10 + 5 : pick(r, [21, 31, 41, 19, 29, 39, 51, 49, 61, 59, 99, 101]);
    return {
      prompt: `Mental math: ${k}²`, answerType: 'number', answer: n(k * k),
      hints: end5 ? ['For numbers ending in 5: multiply the tens digit by the next number, then write 25.', `${Math.floor(k / 10)} × ${Math.floor(k / 10) + 1} = ${Math.floor(k / 10) * (Math.floor(k / 10) + 1)}.`, 'Append 25.'] : ['Use (a ± b)² = a² ± 2ab + b².', `${k} is close to ${Math.round(k / 10) * 10}.`, `${Math.round(k / 10) * 10}² = ${(Math.round(k / 10) * 10) ** 2}.`],
      steps: frame(`Square ${k}.`, end5 ? 'Ending-in-5 trick.' : 'Expand around a round number.', [`${k}² = ${k * k}`], '✓'), explanation: `${k}² = ${k * k}.`, verify: { kind: 'numeric', expr: `${k}^2` },
    };
  },

  // ───────────────────────── REAL-WORLD MATH
  money: (r, d) => {
    if (d <= 2) {
      const coins = Array.from({ length: ri(r, 2, 5 + d) }, () => pick(r, [25, 10, 5, 1])).sort((a, b) => b - a); const total = coins.reduce((s, c) => s + c, 0);
      return { prompt: 'How many cents are these coins worth in total? (quarter 25¢, dime 10¢, nickel 5¢, penny 1¢)', answerType: 'number', unit: '¢', answer: n(total), visual: { type: 'coins', coins }, hints: ['Start with the biggest coins.', 'Count on: 25, 50, … then 10s, then 5s, then 1s.', `Biggest coin: ${coins[0]}¢.`], steps: frame('Total the coins.', 'Count from largest to smallest.', [`${coins.join(' + ')} = ${total}¢`], 'Counted each coin once ✓'), explanation: `The coins are worth ${total}¢.`, verify: { kind: 'numeric', expr: coins.join('+') } };
    }
    const price = ri(r, 105, 1895) / 100; const paid = price < 5 ? 5 : price < 10 ? 10 : 20; const change = round(paid - price, 2);
    return { prompt: `A snack costs $${price.toFixed(2)}. You pay with a $${paid} bill. How much change do you get?`, answerType: 'number', unit: '$', answer: n(change), hints: ['Change = amount paid − price.', 'Count up from the price to the amount paid.', `${paid} − ${price.toFixed(2)}.`], steps: frame('Find the change.', 'Subtract the price from the amount paid.', [`${paid}.00 − ${price.toFixed(2)} = ${change.toFixed(2)}`], `${price.toFixed(2)} + ${change.toFixed(2)} = ${paid}.00 ✓`), explanation: `Your change is $${change.toFixed(2)}.`, verify: { kind: 'numeric', expr: `${paid}-${price}` }, context: 'shopping' };
  },
  'recipe-scaling': (r) => {
    const s = pick(r, [2, 4, 6, 8]); let t = pick(r, [3, 4, 6, 8, 10, 12]); while (t === s) t = pick(r, [3, 4, 6, 8, 10, 12]);
    const q = pick(r, [0.5, 0.75, 1, 1.5, 2, 3]); const ans = round((q * t) / s, 3); const ing = pick(r, ['cups of flour', 'cups of milk', 'tablespoons of sugar', 'cups of rice']);
    return {
      prompt: `A recipe for ${s} people uses ${n(q)} ${ing}. How many ${ing} do you need for ${t} people? (decimal answer)`, answerType: 'number', answer: n(ans), tolerance: 0.01,
      hints: ['Find the scale factor first.', 'Scale factor = new servings ÷ original servings.', `${t} ÷ ${s} = ${n(round(t / s, 3))}.`],
      steps: frame(`Scale a recipe from ${s} to ${t} servings.`, 'Multiply by the scale factor.', [`Scale factor: ${t}/${s} = ${frac(t, s)}`, `${n(q)} × ${frac(t, s)} = ${n(ans)}`], `${t > s ? 'More' : 'Fewer'} people → ${t > s ? 'more' : 'less'} ingredient ✓`),
      explanation: `You need ${n(ans)} ${ing}.`, verify: { kind: 'numeric', expr: `${q}*${t}/${s}` }, context: 'cooking',
    };
  },
  'shopping-discounts': (r, d) => {
    const price = ri(r, 4, 40) * 5; const off = pick(r, [10, 15, 20, 25, 30, 40, 50]); const tax = d >= 3 ? pick(r, [5, 8, 13, 15]) : 0;
    const sale = price * (1 - off / 100); const total = round(sale * (1 + tax / 100), 2);
    return {
      prompt: tax ? `A jacket costs $${price}. It is ${off}% off, then ${tax}% sales tax is added. What is the final price?` : `A jacket costs $${price}. It is ${off}% off. What is the sale price?`,
      answerType: 'number', unit: '$', answer: n(total), tolerance: 0.011,
      hints: ['First find the discounted price.', `Sale price = price × (1 − ${off / 100}).${tax ? ` Then multiply by (1 + ${tax / 100}) for tax.` : ''}`, `${price} × ${round(1 - off / 100, 2)} = ${n(sale)}.`],
      steps: frame('Find the final price.', 'Apply the discount, then tax.', [`Sale: ${price} × ${round(1 - off / 100, 2)} = ${n(sale)}`, ...(tax ? [`With tax: ${n(sale)} × ${1 + tax / 100} = ${total.toFixed(2)}`] : [])], 'Final price is less than the original ✓'),
      explanation: `The final price is $${total.toFixed(2)}.`, verify: { kind: 'numeric', expr: `${price}*(1-${off}/100)*(1+${tax}/100)` }, context: 'shopping',
      mistakes: [{ answer: n(round(price * (off / 100), 2)), type: 'discount-not-price', message: 'That is the amount saved. The question asks for the price you pay.' }],
    };
  },
  'speed-distance': (r) => {
    const s = ri(r, 4, 24) * 5; const t = pick(r, [1.5, 2, 2.5, 3, 4, 0.5]); const dist = s * t; const mode = ri(r, 0, 2);
    const q: [string, number, string][] = [
      [`A car travels at ${s} km/h for ${n(t)} hours. How far does it go (km)?`, dist, `d = s × t = ${s} × ${n(t)}`],
      [`A train travels ${n(dist)} km at ${s} km/h. How many hours does the trip take?`, t, `t = d ÷ s = ${n(dist)} ÷ ${s}`],
      [`A cyclist covers ${n(dist)} km in ${n(t)} hours. What is the average speed (km/h)?`, s, `s = d ÷ t = ${n(dist)} ÷ ${n(t)}`],
    ];
    const [prompt, ans, rule] = q[mode];
    return { prompt, answerType: 'number', answer: n(ans), hints: ['Write down what you know: distance, speed, time.', 'd = s × t. Rearrange for what you need.', rule], steps: frame('Travel problem.', 'Use d = s·t.', [`${rule} = ${n(ans)}`], 'Units check: km, h and km/h are consistent ✓'), explanation: `${rule} = ${n(ans)}.`, verify: { kind: 'numeric', expr: `${ans}` }, context: 'travel' };
  },
  'fuel-cost': (r) => {
    const dist = ri(r, 10, 60) * 10; const eff = pick(r, [5, 6, 7, 8, 9, 10]); const price = ri(r, 120, 199) / 100; const cost = round((dist * eff / 100) * price, 2);
    return {
      prompt: `A car uses ${eff} L of fuel per 100 km. Fuel costs $${price.toFixed(2)}/L. What does a ${dist} km trip cost in fuel?`, answerType: 'number', unit: '$', answer: n(cost), tolerance: 0.011,
      hints: ['First find the litres needed.', `Litres = distance ÷ 100 × ${eff}.`, `${dist} ÷ 100 × ${eff} = ${n(dist * eff / 100)} L.`],
      steps: frame('Find total fuel cost.', 'Fuel needed × price per litre.', [`Fuel: ${n(dist * eff / 100)} L`, `Cost: ${n(dist * eff / 100)} × ${price.toFixed(2)} = ${cost.toFixed(2)}`], 'Units: L × $/L = $ ✓'),
      explanation: `The trip costs about $${cost.toFixed(2)}.`, verify: { kind: 'numeric', expr: `${dist}*${eff}/100*${price}` }, context: 'travel',
    };
  },
  currency: (r) => {
    const amt = ri(r, 2, 50) * 10; const rate = ri(r, 70, 160) / 100; const back = r() < 0.4; const val = back ? round(amt / rate, 2) : round(amt * rate, 2);
    return {
      prompt: back ? `1 CAD = ${rate} EUR. How many CAD is ${amt} EUR? (2 decimal places)` : `1 CAD = ${rate} EUR. How many EUR is ${amt} CAD?`, answerType: 'number', answer: n(val), tolerance: 0.011,
      hints: ['Which direction are you converting?', back ? 'To go from EUR back to CAD, divide by the rate.' : 'Multiply the amount by the rate.', back ? `${amt} ÷ ${rate}` : `${amt} × ${rate}`],
      steps: frame('Convert currency.', back ? 'Divide by the rate.' : 'Multiply by the rate.', [`${back ? `${amt} ÷ ${rate}` : `${amt} × ${rate}`} = ${val.toFixed(2)}`], 'Reasonableness check ✓'),
      explanation: `${amt} ${back ? 'EUR' : 'CAD'} = ${val.toFixed(2)} ${back ? 'CAD' : 'EUR'}.`, verify: { kind: 'numeric', expr: back ? `${amt}/${rate}` : `${amt}*${rate}` }, context: 'travel',
    };
  },
  'sports-stats': (r) => {
    if (r() < 0.5) {
      const att = ri(r, 4, 25) * 4; const made = ri(r, Math.floor(att * 0.25), Math.floor(att * 0.8)); const pct = round((made / att) * 100, 1);
      return { prompt: `A basketball player made ${made} of ${att} shots. What is the shooting percentage? (1 decimal place)`, answerType: 'number', unit: '%', answer: n(pct), tolerance: 0.051, hints: ['Shooting % = made ÷ attempted × 100.', 'Divide first, then multiply by 100.', `${made} ÷ ${att} = ${n(round(made / att, 4))}.`], steps: frame('Shooting percentage.', 'made ÷ attempts × 100.', [`${made} ÷ ${att} × 100 = ${pct}%`], 'Between 0 and 100 ✓'), explanation: `${pct}%.`, verify: { kind: 'numeric', expr: `${made}/${att}*100` }, context: 'sports' };
    }
    const games = ri(r, 4, 12); const per = ri(r, 8, 30); const total = games * per;
    return { prompt: `A soccer team scored ${total} goals in ${games} games. What is the average number of goals per game?`, answerType: 'number', answer: n(per), hints: ['Average = total ÷ number of games.', `${total} ÷ ${games}.`, 'Check by multiplying back.'], steps: frame('Average per game.', 'Divide total by games.', [`${total} ÷ ${games} = ${per}`], `${per} × ${games} = ${total} ✓`), explanation: `${per} goals per game.`, verify: { kind: 'numeric', expr: `${total}/${games}` }, context: 'sports' };
  },
  'profit-margin': (r, d) => {
    const price = ri(r, 2, 20); const qty = ri(r, 10, 100) * 10; const costPer = round(price * ri(r, 30, 80) / 100, 2); const fixed = ri(r, 1, 20) * 50;
    const revenue = price * qty; const expenses = round(costPer * qty + fixed, 2); const profit = round(revenue - expenses, 2);
    if (d <= 2 || profit <= 0) return { prompt: `A shop sells ${qty} items at $${price} each. Expenses total $${expenses.toFixed(2)}. What is the profit?`, answerType: 'number', unit: '$', answer: n(profit), tolerance: 0.011, hints: ['Revenue = price × quantity.', 'Profit = revenue − expenses.', `Revenue = ${revenue}.`], steps: frame('Find profit.', 'Revenue minus expenses.', [`Revenue: ${price} × ${qty} = ${revenue}`, `Profit: ${revenue} − ${expenses.toFixed(2)} = ${profit.toFixed(2)}`], 'Profit < revenue ✓'), explanation: `Profit = $${profit.toFixed(2)}.`, verify: { kind: 'numeric', expr: `${price}*${qty}-${expenses}` }, context: 'business', mistakes: [{ answer: n(revenue), type: 'revenue-not-profit', message: 'That is the revenue. Profit subtracts the expenses.' }] };
    const margin = round((profit / revenue) * 100, 1);
    return { prompt: `Revenue is $${revenue} and expenses are $${expenses.toFixed(2)}. What is the profit margin (%)? (1 decimal place)`, answerType: 'number', unit: '%', answer: n(margin), tolerance: 0.051, hints: ['First find profit.', 'Margin = profit ÷ revenue × 100.', `Profit = ${profit.toFixed(2)}.`], steps: frame('Find profit margin.', 'Profit as a percent of revenue.', [`Profit: ${profit.toFixed(2)}`, `${profit.toFixed(2)} ÷ ${revenue} × 100 = ${margin}%`], 'Margin between 0 and 100% ✓'), explanation: `Profit margin ≈ ${margin}%.`, verify: { kind: 'numeric', expr: `(${revenue}-${expenses})/${revenue}*100` }, context: 'business' };
  },
  'simple-interest': (r) => {
    const P = ri(r, 5, 50) * 100; const rate = pick(r, [2, 3, 4, 5, 6, 8]); const t = ri(r, 1, 6); const I = (P * rate * t) / 100;
    return { prompt: `You invest $${P.toLocaleString('en-US')} at ${rate}% simple interest per year for ${t} years. How much interest do you earn?`, answerType: 'number', unit: '$', answer: n(I), hints: ['I = P × r × t.', `Write ${rate}% as ${rate / 100}.`, `${P} × ${rate / 100} × ${t}.`], steps: frame('Simple interest.', 'I = Prt.', [`${P} × ${rate / 100} × ${t} = ${n(I)}`], 'Interest is a fraction of principal per year ✓'), explanation: `You earn $${n(I)}.`, verify: { kind: 'numeric', expr: `${P}*${rate}/100*${t}` }, context: 'finance', mistakes: [{ answer: n(P + I), type: 'total-not-interest', message: 'That is the total balance. The question asks for the interest only.' }] };
  },
  'engineering-formulas': (r) => {
    const kind = ri(r, 0, 2);
    if (kind === 0) { const m = ri(r, 2, 50), a = ri(r, 2, 12); return { prompt: `A ${m} kg cart accelerates at ${a} m/s². What net force acts on it (in newtons)? Use F = m·a.`, answerType: 'number', unit: 'N', answer: n(m * a), hints: ['Identify m and a.', 'F = m × a.', `${m} × ${a}.`], steps: frame('Find the force.', 'F = ma.', [`${m} × ${a} = ${m * a} N`], 'kg·m/s² = N ✓'), explanation: `F = ${m * a} N.`, verify: { kind: 'numeric', expr: `${m}*${a}` }, context: 'engineering' }; }
    if (kind === 1) { const F = ri(r, 5, 80) * 10, dd = ri(r, 2, 20); return { prompt: `A force of ${F} N pushes a crate ${dd} m. How much work is done (in joules)? Use W = F·d.`, answerType: 'number', unit: 'J', answer: n(F * dd), hints: ['Work = force × distance.', 'Units: N × m = J.', `${F} × ${dd}.`], steps: frame('Find work.', 'W = Fd.', [`${F} × ${dd} = ${F * dd} J`], 'N·m = J ✓'), explanation: `W = ${F * dd} J.`, verify: { kind: 'numeric', expr: `${F}*${dd}` }, context: 'engineering' }; }
    const A = pick(r, [0.5, 2, 4, 5, 0.25]); const F = A * ri(r, 10, 200) * 10;
    return { prompt: `A force of ${n(F)} N acts on an area of ${n(A)} m². What is the pressure in pascals? Use P = F / A.`, answerType: 'number', unit: 'Pa', answer: n(F / A), hints: ['Pressure = force ÷ area.', 'Smaller area → bigger pressure.', `${n(F)} ÷ ${n(A)}.`], steps: frame('Find pressure.', 'P = F/A.', [`${n(F)} ÷ ${n(A)} = ${n(F / A)} Pa`], 'N/m² = Pa ✓'), explanation: `P = ${n(F / A)} Pa.`, verify: { kind: 'numeric', expr: `${F}/${A}` }, context: 'engineering' };
  },
  'compound-interest': (r, d) => {
    const P = ri(r, 10, 100) * 100; const rate = pick(r, [2, 3, 4, 5, 6, 7]); const t = ri(r, 2, 10); const nper = d >= 3 ? pick(r, [1, 4, 12]) : 1;
    const A = round(P * (1 + rate / 100 / nper) ** (nper * t), 2);
    return {
      prompt: `$${P.toLocaleString('en-US')} is invested at ${rate}% per year, compounded ${nper === 1 ? 'annually' : nper === 4 ? 'quarterly' : 'monthly'}, for ${t} years. What is the final amount? (nearest cent)`, answerType: 'number', unit: '$', answer: n(A), tolerance: 0.02,
      hints: ['Use A = P(1 + r/n)^(nt).', `r = ${rate / 100}, n = ${nper}, t = ${t}.`, `Growth factor per period: ${n(1 + rate / 100 / nper)}.`],
      steps: frame('Compound interest.', 'A = P(1 + r/n)^(nt).', [`A = ${P}(1 + ${rate / 100}/${nper})^(${nper * t})`, `A ≈ ${A.toFixed(2)}`], `More than simple interest (${n(P + (P * rate * t) / 100)}) ✓`),
      explanation: `The investment grows to $${A.toFixed(2)}.`, verify: { kind: 'numeric', expr: `${P}*(1+${rate}/100/${nper})^(${nper}*${t})` }, context: 'finance',
      mistakes: [{ answer: n(P + (P * rate * t) / 100), type: 'used-simple', message: 'That is the simple-interest amount. With compounding, interest earns interest.' }],
    };
  },
  'growth-rates': (r) => {
    const start = ri(r, 10, 100) * 10; const g = pick(r, [5, 8, 10, 12, 15, 20]); const t = ri(r, 2, 6); const end = round(start * (1 + g / 100) ** t, 2);
    return {
      prompt: `A company’s revenue grew from $${start}k to $${end}k over ${t} years. What is the compound annual growth rate (CAGR) in %? (nearest whole percent)`, answerType: 'number', unit: '%', answer: n(g), tolerance: 0.51,
      hints: ['CAGR = (end ÷ start)^(1/years) − 1.', `${end} ÷ ${start} = ${n(round(end / start, 4))}.`, `Take the ${t}th root, subtract 1, × 100.`],
      steps: frame('Compute CAGR.', 'Geometric average growth.', [`(${end}/${start})^(1/${t}) = ${n(round(1 + g / 100, 4))}`, `− 1 = ${g / 100} → ${g}%`], `${start} × ${1 + g / 100}^${t} ≈ ${end} ✓`),
      explanation: `CAGR ≈ ${g}%.`, verify: { kind: 'numeric', expr: `((${end}/${start})^(1/${t})-1)*100` }, context: 'finance',
      mistakes: [{ answer: n(round(((end - start) / start) * 100 / t, 0)), type: 'arithmetic-average', message: 'That is the simple average. CAGR accounts for compounding — use the t-th root.' }],
    };
  },
  'present-value': (r) => {
    const FV = ri(r, 10, 100) * 100; const rate = pick(r, [3, 4, 5, 6, 8, 10]); const t = ri(r, 2, 10); const PV = round(FV / (1 + rate / 100) ** t, 2);
    return {
      prompt: `How much must you invest today at ${rate}% per year (compounded annually) to have $${FV.toLocaleString('en-US')} in ${t} years? (nearest cent)`, answerType: 'number', unit: '$', answer: n(PV), tolerance: 0.02,
      hints: ['This is a present-value question.', 'PV = FV ÷ (1 + r)^t.', `(1 + ${rate / 100})^${t} = ${n(round((1 + rate / 100) ** t, 4))}.`],
      steps: frame('Discount future money.', 'PV = FV/(1+r)^t.', [`${FV} ÷ ${n(round((1 + rate / 100) ** t, 4))} ≈ ${PV.toFixed(2)}`], `${PV.toFixed(2)} × (1.${String(rate).padStart(2, '0')})^${t} ≈ ${FV} ✓`),
      explanation: `Invest $${PV.toFixed(2)} today.`, verify: { kind: 'numeric', expr: `${FV}/(1+${rate}/100)^${t}` }, context: 'finance',
    };
  },
  mortgage: (r) => {
    const P = ri(r, 10, 60) * 10000; const rate = pick(r, [3, 4, 4.5, 5, 6, 7]); const years = pick(r, [10, 15, 20, 25, 30]); const i = rate / 100 / 12; const N = years * 12;
    const M = round((P * i * (1 + i) ** N) / ((1 + i) ** N - 1), 2);
    return {
      prompt: `A $${P.toLocaleString('en-US')} mortgage at ${rate}% annual interest is repaid monthly over ${years} years. What is the monthly payment? (nearest cent)`, answerType: 'number', unit: '$', answer: n(M), tolerance: 0.05,
      hints: ['Convert to a monthly rate and number of payments.', `i = ${rate}% ÷ 12 = ${n(round(i, 6))}; n = ${N}.`, 'M = P·i(1+i)ⁿ / ((1+i)ⁿ − 1).'],
      steps: frame('Monthly mortgage payment.', 'Use the amortization formula.', [`i = ${n(round(i, 6))}, n = ${N}`, `M = ${P}·${n(round(i, 6))}·(1+i)^${N} / ((1+i)^${N} − 1) ≈ ${M.toFixed(2)}`], `Total paid ≈ $${Math.round(M * N).toLocaleString('en-US')} > $${P.toLocaleString('en-US')} because of interest ✓`),
      explanation: `The monthly payment is about $${M.toFixed(2)}.`, verify: { kind: 'numeric', expr: `${P}*${i}*(1+${i})^${N}/((1+${i})^${N}-1)` }, context: 'finance',
    };
  },

  // ───────────────────────── PUZZLES
  'k-patterns': (r) => {
    const sets = [['🔴', '🔵'], ['⭐', '🌙', '⭐'], ['🍎', '🍌', '🍇'], ['🐶', '🐱'], ['🟩', '🟨', '🟨']];
    const unitP = pick(r, sets); const len = unitP.length * 2 + ri(r, 0, unitP.length - 1); const items = Array.from({ length: len }, (_, i) => unitP[i % unitP.length]);
    const next = unitP[len % unitP.length]; const opts = [...new Set([...unitP, '🟣', '🔺'])];
    return { prompt: 'What comes next in the pattern?', answerType: 'choice', answer: next, choices: choices(r, next, opts.filter((o) => o !== next)), visual: { type: 'pattern', items }, hints: ['Say the pattern out loud.', 'Find the part that repeats.', `The repeating part is ${unitP.join(' ')}.`], steps: frame('Continue the pattern.', 'Find the repeating unit.', [`Unit: ${unitP.join(' ')}`, `Next: ${next}`], 'The pattern keeps repeating ✓'), explanation: `${next} comes next because the pattern ${unitP.join(' ')} repeats.`, verify: { kind: 'choice' } };
  },
  'sequences-next': (r, d) => {
    const kind = ri(r, 0, d >= 3 ? 3 : 1); let seq: number[] = []; let rule = '';
    if (kind === 0) { const a = ri(r, 1, 20), dd = ri(r, 2, 9) * sign1(r); seq = [0, 1, 2, 3, 4].map((i) => a + i * dd); rule = `add ${dd}`; }
    else if (kind === 1) { const a = ri(r, 1, 5), m = ri(r, 2, 3); seq = [0, 1, 2, 3, 4].map((i) => a * m ** i); rule = `multiply by ${m}`; }
    else if (kind === 2) { const s = ri(r, 1, 4); seq = [0, 1, 2, 3, 4].map((i) => (s + i) ** 2); rule = 'square numbers'; }
    else { const a = ri(r, 1, 3), b = ri(r, 1, 4); seq = [a, b]; while (seq.length < 5) seq.push(seq[seq.length - 1] + seq[seq.length - 2]); rule = 'add the two previous terms'; }
    const ans = seq.pop()!;
    return { prompt: `What comes next? ${seq.join(', ')}, ?`, answerType: 'number', answer: n(ans), hints: ['Look at how each term changes.', 'Check differences; if not constant, try ratios or other patterns.', `Rule hint: ${rule.split(' ')[0]}…`], steps: frame('Find the rule.', 'Compare consecutive terms.', [`Rule: ${rule}`, `Next term: ${ans}`], 'The rule fits every term ✓'), explanation: `The rule is "${rule}", so the next term is ${ans}.`, verify: { kind: 'numeric', expr: `${ans}` } };
  },
  'missing-digit': (r, d) => {
    if (d <= 2) { const a = ri(r, 2, 12), b = ri(r, 2, 12); return { prompt: `□ × ${a} = ${a * b}. What number goes in the box?`, answerType: 'number', answer: n(b), hints: ['Work backwards.', 'Division undoes multiplication.', `${a * b} ÷ ${a}.`], steps: frame('Find the missing number.', 'Use the inverse operation.', [`${a * b} ÷ ${a} = ${b}`], `${b} × ${a} = ${a * b} ✓`), explanation: `□ = ${b}.`, verify: { kind: 'numeric', expr: `${a * b}/${a}` } }; }
    const x = ri(r, 2, 20), m = ri(r, 2, 9), a = ri(r, 1, 20); const res = x * m + a;
    return { prompt: `I think of a number. I multiply it by ${m}, then add ${a}. The result is ${res}. What was my number?`, answerType: 'number', answer: n(x), hints: ['Work backwards from the result.', 'Undo the last step first: subtract, then divide.', `${res} − ${a} = ${res - a}.`], steps: frame('Reverse the operations.', 'Undo in reverse order.', [`${res} − ${a} = ${res - a}`, `${res - a} ÷ ${m} = ${x}`], `${x} × ${m} + ${a} = ${res} ✓`), explanation: `The number was ${x}.`, verify: { kind: 'equation', eq: `${m}*x+${a}=${res}`, variable: 'x' }, mistakes: [{ answer: n((res / m) - a), type: 'wrong-undo-order', message: 'Undo the steps in REVERSE order: subtract first, then divide.' }] };
  },
  'logic-puzzles': (r, d) => {
    const kind = ri(r, 0, d >= 3 ? 2 : 1);
    if (kind === 0) { const s = ri(r, 3, 12), k = ri(r, 2, 4), y = ri(r, 2, 10); const sum = s + k * s + 2 * y; return { prompt: `Ali is ${k} times as old as Sara. In ${y} years, the sum of their ages will be ${sum}. How old is Sara now?`, answerType: 'number', answer: n(s), hints: ['Let Sara’s age be s.', `Ali is ${k}s. In ${y} years: (s + ${y}) + (${k}s + ${y}) = ${sum}.`, `Simplify: ${k + 1}s + ${2 * y} = ${sum}.`], steps: frame('Age puzzle.', 'Translate the clues into an equation.', [`(s + ${y}) + (${k}s + ${y}) = ${sum}`, `${k + 1}s = ${sum - 2 * y}`, `s = ${s}`], `Sara ${s}, Ali ${k * s}; in ${y} years: ${s + y} + ${k * s + y} = ${sum} ✓`), explanation: `Sara is ${s}.`, verify: { kind: 'equation', eq: `(x+${y})+(${k}*x+${y})=${sum}`, variable: 'x' } }; }
    if (kind === 1) { const a = ri(r, 5, 40); const cnt = 3; const sum = a * cnt + 3; return { prompt: `The sum of three consecutive whole numbers is ${sum}. What is the smallest number?`, answerType: 'number', answer: n(a), hints: ['Call the numbers n, n + 1, n + 2.', 'Add them: 3n + 3.', `3n + 3 = ${sum}.`], steps: frame('Consecutive numbers.', 'Use n, n+1, n+2.', [`3n + 3 = ${sum}`, `n = ${a}`], `${a} + ${a + 1} + ${a + 2} = ${sum} ✓`), explanation: `The numbers are ${a}, ${a + 1}, ${a + 2}.`, verify: { kind: 'equation', eq: `3*x+3=${sum}`, variable: 'x' } }; }
    const q = ri(r, 2, 12), dm = ri(r, 2, 12); const total = q * 25 + dm * 10; const cnt = q + dm;
    return { prompt: `A jar has ${cnt} coins, all quarters (25¢) and dimes (10¢), worth $${(total / 100).toFixed(2)} in total. How many quarters are there?`, answerType: 'number', answer: n(q), hints: ['Let q = quarters; then dimes = total coins − q.', `Value: 25q + 10(${cnt} − q) = ${total}.`, `15q + ${10 * cnt} = ${total}.`], steps: frame('Coin puzzle.', 'Two clues → one equation.', [`25q + 10(${cnt} − q) = ${total}`, `15q = ${total - 10 * cnt}`, `q = ${q}`], `${q} quarters + ${dm} dimes = ${total}¢ ✓`), explanation: `${q} quarters.`, verify: { kind: 'equation', eq: `25*x+10*(${cnt}-x)=${total}`, variable: 'x' } };
  },
};

function sign1(r: Rng) { return r() < 0.75 ? 1 : -1; }
// keep linter quiet about unused helpers in some builds
void dn; void money; void nz; void fact;
