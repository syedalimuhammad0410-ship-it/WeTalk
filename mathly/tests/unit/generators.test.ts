import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS, missingGenerators, generateQuestion } from '../../server/engine/index.ts';
import { verifyQuestion, checkAnswer, sanitizeQuestion } from '../../server/engine/check.ts';
import { makeRng } from '../../server/engine/util.ts';
import { SKILLS } from '../../shared/skills.ts';
import { CORE_COURSES } from '../../shared/curriculum.ts';

test('every skill has a generator', () => {
  assert.deepEqual(missingGenerators(), []);
});

test('course lessons reference real skills', () => {
  const ids = new Set(SKILLS.map((s) => s.id));
  for (const c of CORE_COURSES) for (const u of c.units) for (const l of u.lessons) assert.ok(ids.has(l.skillId!), `${c.id} → ${l.skillId}`);
  for (const s of SKILLS) for (const p of s.prereqs) assert.ok(ids.has(p), `${s.id} prereq ${p}`);
});

test('every generator produces verified, self-consistent questions at every difficulty', () => {
  const failures: string[] = []; const weak: string[] = [];
  for (const id of Object.keys(GENERATORS)) {
    for (let d = 1; d <= 5; d++) {
      let ok = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const rng = makeRng(seed * 7919 + d * 104729 + id.length);
        try {
          const q = sanitizeQuestion({ ...GENERATORS[id](rng, d), id: 'x', skillId: id, difficulty: d });
          const v = verifyQuestion(q);
          if (v.ok) ok++; else if (failures.length < 400) failures.push(`${id} d${d} seed${seed}: ${v.reason} | ${q.prompt} → ${q.answer}`);
        } catch (e) {
          if (failures.length < 400) failures.push(`${id} d${d} seed${seed}: threw ${(e as Error).message}`);
        }
      }
      // A small rejection rate is fine (generateQuestion retries) but a template must mostly work.
      if (ok < 36) weak.push(`${id} d${d}: only ${ok}/40 verified`);
    }
  }
  assert.deepEqual(weak, [], failures.join('\n'));
  if (failures.length) console.log(`Rejected drafts (retried in production):\n${failures.slice(0, 15).join('\n')}`);
});

test('generateQuestion always returns verified content', () => {
  for (const s of SKILLS) for (let d = 1; d <= 5; d++) {
    const q = generateQuestion(s.id, d);
    assert.ok(checkAnswer(q, q.answer).correct, `${s.id}: ${q.answer}`);
  }
});

test('answer checker accepts equivalent forms', () => {
  const base = { id: 'x', skillId: 'two-step-eq', difficulty: 2, hints: ['h'], steps: ['s'], explanation: '', prompt: 'p', verify: { kind: 'none' as const, reason: '' } };
  assert.ok(checkAnswer({ ...base, answerType: 'number', answer: '5' }, 'x = 5').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'number', answer: '0.75' }, '3/4').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'number', answer: '1500' }, '1,500').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'number', answer: '48', unit: 'cm²' }, '48 cm²').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'set', answer: '-3, 2' }, 'x = 2 or x = -3').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'pair', answer: '(2, -1)' }, '2,-1').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'expression', answer: '6x^2 - 4', variable: 'x' }, '-4 + 6x²').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'antiderivative', answer: 'x^3', variable: 'x' }, 'x^3 + 7 + C').correct);
  assert.ok(!checkAnswer({ ...base, answerType: 'fraction', answer: '2/3', requireSimplest: true }, '4/6').correct);
  assert.ok(checkAnswer({ ...base, answerType: 'text', answer: '26 R1', accept: ['26r1'] }, '26 remainder 1').correct);
  assert.ok(!checkAnswer({ ...base, answerType: 'number', answer: '5' }, 'import("fs")').correct);
});
