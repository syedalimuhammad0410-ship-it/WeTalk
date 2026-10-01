import { randomUUID } from 'node:crypto';
import type { PublicQuestion, Question } from '../../shared/types.ts';
import { SKILLS, SKILL_MAP } from '../../shared/skills.ts';
import { foundationGenerators } from './gen-foundations.ts';
import { advancedGenerators } from './gen-advanced.ts';
import { makeRng, type Rng } from './util.ts';
import { sanitizeQuestion, verifyQuestion } from './check.ts';

export const GENERATORS = { ...foundationGenerators, ...advancedGenerators };

/** Skills without a generator would be a content bug — surfaced by the unit tests. */
export const missingGenerators = () => SKILLS.filter((s) => !GENERATORS[s.id]).map((s) => s.id);

/**
 * Generate a verified question for a skill. Generation is retried if verification fails,
 * so a buggy template can never reach a student with a wrong answer key.
 */
export function generateQuestion(skillId: string, difficulty = 2, rng: Rng = Math.random, attempts = 8): Question {
  const gen = GENERATORS[skillId];
  if (!gen || !SKILL_MAP[skillId]) throw new Error(`Unknown skill ${skillId}`);
  const d = Math.max(1, Math.min(5, Math.round(difficulty)));
  let lastReason = '';
  for (let i = 0; i < attempts; i++) {
    const draft = gen(rng, d);
    const q: Question = sanitizeQuestion({ ...draft, id: randomUUID(), skillId, difficulty: d, source: 'generator' });
    const v = verifyQuestion(q);
    if (v.ok) return q;
    lastReason = v.reason ?? '';
  }
  throw new Error(`Could not generate a verified question for ${skillId}: ${lastReason}`);
}

export const seededRng = makeRng;

export function toPublic(q: Question): PublicQuestion {
  const { answer: _a, accept: _b, hints, steps: _c, explanation: _d, mistakes: _e, verify: _f, ...rest } = q;
  return { ...rest, hintCount: hints.length };
}
