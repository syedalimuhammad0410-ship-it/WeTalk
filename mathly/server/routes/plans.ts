// Test preparation, readiness, mock tests, smart study planner and homework organizer.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import type { Question } from '../../shared/types.ts';
import { SKILLS, SKILL_MAP } from '../../shared/skills.ts';
import { all, json, one, run } from '../db.ts';
import { requireProfile, type ProfileRow } from '../auth.ts';
import { bad, notFound, num, str, strArray } from '../security.ts';
import { awardXp, checkAchievements, computeLearningLevel, masteryMap, notify, recordActivity, today, updateMastery } from '../learning.ts';
import { generateQuestion, toPublic } from '../engine/index.ts';
import { checkAnswer, toNumber } from '../engine/check.ts';
import { makeRng, hashString, shuffle } from '../engine/util.ts';
import { matchSkills } from '../coursegen.ts';
import { track } from '../analytics.ts';

export const plansRouter = Router();
plansRouter.use(requireProfile);
const P = (req: Request) => req.profile!;
const optOut = (p: ProfileRow) => json<{ analyticsOptOut?: boolean }>(p.preferences, {}).analyticsOptOut === true;

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
const isoDate = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad('Please choose a valid date.'); return s; };

// ─────────────────────────────────────────── study-plan generator
interface PlanItem { kind: 'lesson' | 'practice' | 'review' | 'mock' | 'warmup' | 'rest' | 'targeted'; skillId?: string; label: string; minutes: number; done?: boolean }
interface PlanDay { date: string; type: string; title: string; items: PlanItem[]; done: boolean; moved?: boolean }

export function generatePlan(skills: string[], testDate: string, mm: ReturnType<typeof masteryMap>, confidence: Record<string, number>, startDate = today()): PlanDay[] {
  const n = Math.max(1, daysBetween(startDate, testDate) + 1);
  const t = (id: string) => SKILL_MAP[id]?.title ?? id;
  // Weakest topics first: low mastery and low self-reported confidence.
  const ranked = [...skills].sort((a, b) => ((mm[a]?.effective ?? 30) + (confidence[a] ?? 1.5) * 10) - ((mm[b]?.effective ?? 30) + (confidence[b] ?? 1.5) * 10));
  const weak = ranked.filter((s) => (mm[s]?.effective ?? 0) < 70 || (confidence[s] ?? 2) <= 1).slice(0, 3);
  const days: PlanDay[] = [];
  const special: Record<number, PlanDay> = {};
  const last = n - 1;
  special[last] = { date: addDays(startDate, last), type: 'warmup', title: 'Test day: 5-minute warm-up', items: [{ kind: 'warmup', label: 'Quick warm-up on your strongest topic', skillId: ranked[ranked.length - 1], minutes: 5 }], done: false };
  if (n >= 3) special[last - 1] = { date: addDays(startDate, last - 1), type: 'mock', title: 'Mock test', items: [{ kind: 'mock', label: 'Timed mock test covering every topic', minutes: 30 }], done: false };
  if (n >= 4) special[last - 2] = { date: addDays(startDate, last - 2), type: 'weak', title: 'Weak-topic focus', items: (weak.length ? weak : ranked.slice(0, 2)).map((s) => ({ kind: 'targeted' as const, skillId: s, label: `Targeted practice: ${t(s)}`, minutes: 10 })), done: false };
  if (n >= 6) special[last - 3] = { date: addDays(startDate, last - 3), type: 'mixed', title: 'Mixed practice', items: ranked.slice(0, 4).map((s) => ({ kind: 'practice' as const, skillId: s, label: `Mixed: ${t(s)}`, minutes: 6 })), done: false };
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!special[i]) free.push(i);
  // Rest day roughly every 7th study day for long plans.
  const rest = new Set(n > 9 ? free.filter((_, k) => k > 0 && (k + 1) % 7 === 0) : []);
  const study = free.filter((i) => !rest.has(i));
  const queue: PlanItem[] = ranked.flatMap((s) => [{ kind: 'lesson' as const, skillId: s, label: `Concept review: ${t(s)}`, minutes: 10 }, { kind: 'practice' as const, skillId: s, label: `Practice: ${t(s)}`, minutes: 10 }]);
  const perDay = study.length ? Math.max(1, Math.ceil(queue.length / study.length)) : queue.length;
  let qi = 0;
  for (let i = 0; i < n; i++) {
    if (special[i]) { days.push(special[i]); continue; }
    const date = addDays(startDate, i);
    if (rest.has(i)) { days.push({ date, type: 'rest', title: 'Rest day', items: [{ kind: 'rest', label: 'Rest and recharge — your brain consolidates learning while you rest.', minutes: 0 }], done: false }); continue; }
    let items = queue.slice(qi, qi + perDay); qi += perDay;
    if (!items.length) items = [{ kind: 'review', skillId: ranked[i % ranked.length], label: `Review: ${t(ranked[i % ranked.length])}`, minutes: 8 }];
    const first = items[0]?.skillId;
    days.push({ date, type: items.some((x) => x.kind === 'lesson') ? 'concepts' : 'practice', title: items.some((x) => x.kind === 'lesson') ? `Concepts: ${first ? t(first) : ''}` : 'Practice', items, done: false });
  }
  // Very short plans: fold everything into the available days.
  if (n === 1) days[0].items.unshift(...ranked.slice(0, 3).map((s) => ({ kind: 'practice' as const, skillId: s, label: `Quick practice: ${t(s)}`, minutes: 5 })));
  if (n === 2) days[0].items.push(...weak.map((s) => ({ kind: 'targeted' as const, skillId: s, label: `Targeted practice: ${t(s)}`, minutes: 8 })));
  return days;
}

/** Move unfinished items from missed days onto upcoming study days (never onto the test day). */
export function adjustPlan(days: PlanDay[], now = today()): { days: PlanDay[]; moved: number } {
  const missed: PlanItem[] = [];
  for (const d of days) if (d.date < now && !d.done) { const left = d.items.filter((x) => !x.done && !['rest', 'warmup', 'mock'].includes(x.kind)); if (left.length) { missed.push(...left); d.items = d.items.filter((x) => x.done || ['rest', 'warmup', 'mock'].includes(x.kind)); d.done = true; d.moved = true; } }
  if (!missed.length) return { days, moved: 0 };
  const targets = days.filter((d) => d.date >= now && d.type !== 'warmup' && d.type !== 'mock');
  const pool = targets.length ? targets : days.filter((d) => d.date >= now);
  missed.forEach((item, i) => {
    const target = pool.length ? [...pool].sort((a, b) => a.items.length - b.items.length)[0] : null;
    if (target) { target.items.push({ ...item, label: `${item.label} (moved)` }); if (target.type === 'rest') { target.type = 'practice'; target.title = 'Catch-up practice'; target.items = target.items.filter((x) => x.kind !== 'rest'); } }
    void i;
  });
  return { days, moved: missed.length };
}

function readiness(p: ProfileRow, skills: string[], confidence: Record<string, number>, planId: string) {
  const mm = masteryMap(p.id);
  const mocks = all<{ analysis: string }>('SELECT analysis FROM test_attempts WHERE profile_id = ? AND test_plan_id = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 3', p.id, planId).map((r) => json<{ topics: { skillId: string; percent: number }[] }>(r.analysis, { topics: [] }));
  const topics = skills.map((s) => {
    const mastery = mm[s]?.effective ?? 0;
    const mockScores = mocks.flatMap((m) => m.topics.filter((x) => x.skillId === s).map((x) => x.percent));
    const mock = mockScores.length ? mockScores.reduce((a, b) => a + b, 0) / mockScores.length : null;
    const conf = confidence[s] != null ? (confidence[s] / 3) * 100 : null;
    const est = mock !== null ? mastery * 0.55 + mock * 0.35 + (conf ?? mastery) * 0.1 : mastery * 0.85 + (conf ?? mastery) * 0.15;
    return { skillId: s, title: SKILL_MAP[s]?.title ?? s, percent: Math.round(est), mastery: Math.round(mastery), mock: mock !== null ? Math.round(mock) : null, needsWork: est < 70 };
  });
  const overall = topics.length ? Math.round(topics.reduce((s, x) => s + x.percent, 0) / topics.length) : 0;
  return { overall, topics, note: 'Current preparation estimate based on your practice and mock tests — not a prediction of your test score.' };
}

// ─────────────────────────────────────────── test plans
plansRouter.get('/tests', (req, res) => {
  const p = P(req);
  const rows = all<{ id: string; title: string; test_date: string; skills: string; details: string; archived: number }>('SELECT id, title, test_date, skills, details, archived FROM test_plans WHERE profile_id = ? ORDER BY archived, test_date', p.id);
  res.json({ tests: rows.map((r) => { const d = json<{ confidence?: Record<string, number> }>(r.details, {}); return { id: r.id, title: r.title, testDate: r.test_date, daysLeft: daysBetween(today(), r.test_date), archived: !!r.archived, skills: json<string[]>(r.skills, []).map((s) => SKILL_MAP[s]?.title ?? s), readiness: readiness(p, json<string[]>(r.skills, []), d.confidence ?? {}, r.id).overall }; }) });
});

export function createTestPlan(p: ProfileRow, body: Record<string, unknown>) {
  const title = str(body.title, 'Test name', { max: 120 });
  const testDate = isoDate(str(body.testDate, 'Test date', { max: 10 }));
  if (testDate < today()) throw bad('The test date must be today or later.');
  if (daysBetween(today(), testDate) > 180) throw bad('Please choose a date within the next 6 months.');
  let skills = strArray(body.skills, 'Topics', { maxItems: 15, maxLen: 60 }).filter((s) => SKILL_MAP[s]);
  const topicsText = str(body.topicsText, 'Topics', { optional: true, max: 300 });
  if (!skills.length && (topicsText || title)) skills = matchSkills(`${topicsText} ${title}`).skills.slice(0, 8);
  if (!skills.length) throw bad('Choose at least one topic for the test.');
  const confidence: Record<string, number> = {};
  if (body.confidence && typeof body.confidence === 'object') for (const [k, v] of Object.entries(body.confidence as Record<string, unknown>)) if (SKILL_MAP[k] && [0, 1, 2, 3].includes(Number(v))) confidence[k] = Number(v);
  const details = { about: str(body.about, 'About', { optional: true, max: 500 }), calculator: body.calculator === true, format: str(body.format, 'Format', { optional: true, max: 80 }) || 'Mixed', understanding: str(body.understanding, 'Understanding', { optional: true, max: 300 }), confidence };
  const plan = generatePlan(skills, testDate, masteryMap(p.id), confidence);
  const id = randomUUID();
  run('INSERT INTO test_plans (id, profile_id, title, test_date, skills, details, plan) VALUES (?, ?, ?, ?, ?, ?, ?)', id, p.id, title, testDate, JSON.stringify(skills), JSON.stringify(details), JSON.stringify(plan));
  notify(p.id, 'test', `Study plan ready: ${title}`, `${plan.length} day plan until ${testDate}.`, `/test-prep/${id}`, `plan:${id}`);
  return id;
}

plansRouter.post('/tests', (req, res) => {
  const p = P(req);
  const id = createTestPlan(p, req.body ?? {});
  track('test_plan_created', {}, optOut(p));
  res.json({ id });
});

plansRouter.get('/tests/:id', (req, res) => {
  const p = P(req);
  const r = one<{ id: string; title: string; test_date: string; skills: string; details: string; plan: string; archived: number }>('SELECT * FROM test_plans WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!r) throw notFound('Test plan not found');
  const details = json<{ confidence?: Record<string, number>; calculator?: boolean; format?: string; about?: string }>(r.details, {});
  const { days, moved } = adjustPlan(json<PlanDay[]>(r.plan, []));
  if (moved) run("UPDATE test_plans SET plan = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(days), r.id);
  const skills = json<string[]>(r.skills, []);
  const mocks = all('SELECT id, score, completed_at FROM test_attempts WHERE profile_id = ? AND test_plan_id = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC', p.id, r.id);
  res.json({ test: { id: r.id, title: r.title, testDate: r.test_date, daysLeft: daysBetween(today(), r.test_date), details, skills: skills.map((s) => ({ id: s, title: SKILL_MAP[s]?.title ?? s })), plan: days, moved, archived: !!r.archived }, readiness: readiness(p, skills, details.confidence ?? {}, r.id), mocks, today: today() });
});

plansRouter.post('/tests/:id/items', (req, res) => {
  const p = P(req);
  const r = one<{ plan: string }>('SELECT plan FROM test_plans WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!r) throw notFound();
  const days = json<PlanDay[]>(r.plan, []);
  const di = num(req.body?.day, 'day', { min: 0, max: days.length - 1, int: true })!; const ii = num(req.body?.item, 'item', { min: 0, max: 50, int: true })!;
  const day = days[di]; if (!day?.items[ii]) throw bad('Unknown plan item');
  day.items[ii].done = req.body?.done !== false;
  day.done = day.items.every((x) => x.done || x.kind === 'rest');
  run("UPDATE test_plans SET plan = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(days), req.params.id);
  res.json({ plan: days });
});

plansRouter.post('/tests/:id/regenerate', (req, res) => {
  const p = P(req);
  const r = one<{ skills: string; details: string; test_date: string }>('SELECT skills, details, test_date FROM test_plans WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!r) throw notFound();
  if (r.test_date < today()) throw bad('This test date has passed.');
  const plan = generatePlan(json<string[]>(r.skills, []), r.test_date, masteryMap(p.id), json<{ confidence?: Record<string, number> }>(r.details, {}).confidence ?? {});
  run("UPDATE test_plans SET plan = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(plan), req.params.id);
  res.json({ ok: true });
});
plansRouter.patch('/tests/:id', (req, res) => {
  const p = P(req);
  if (req.body?.archived !== undefined) run('UPDATE test_plans SET archived = ? WHERE id = ? AND profile_id = ?', req.body.archived ? 1 : 0, req.params.id, p.id);
  res.json({ ok: true });
});
plansRouter.delete('/tests/:id', (req, res) => {
  run('DELETE FROM test_plans WHERE id = ? AND profile_id = ?', req.params.id, P(req).id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────── mock tests
type MockQ = Question & { format: 'mc' | 'short' | 'written' };
function toMultipleChoice(q: Question, rng: () => number): Question {
  if (q.answerType === 'choice') return q;
  if (!['number', 'fraction'].includes(q.answerType)) return q;
  const v = toNumber(q.answer); if (v === null) return q;
  const opts = new Set<string>([q.answer]);
  for (const m of q.mistakes ?? []) if (opts.size < 4 && toNumber(m.answer) !== null && Math.abs(toNumber(m.answer)! - v) > 1e-9) opts.add(m.answer);
  const perturb = [v + 1, v - 1, v * 2, v / 2, v + 10, -v, v * 10].map((x) => String(Math.round(x * 1000) / 1000));
  for (const x of shuffle(rng, perturb)) if (opts.size < 4 && Math.abs(Number(x) - v) > 1e-9) opts.add(x);
  return { ...q, answerType: 'choice', choices: shuffle(rng, [...opts]), answer: q.answer };
}

plansRouter.post('/mock-tests', (req, res) => {
  const p = P(req);
  const planId = typeof req.body?.testPlanId === 'string' ? req.body.testPlanId : null;
  let skills = strArray(req.body?.skills, 'skills', { maxItems: 15, maxLen: 60 }).filter((s) => SKILL_MAP[s]);
  if (planId) { const r = one<{ skills: string }>('SELECT skills FROM test_plans WHERE id = ? AND profile_id = ?', planId, p.id); if (r) skills = json<string[]>(r.skills, []); }
  if (!skills.length) throw bad('Choose at least one topic.');
  const count = num(req.body?.count, 'count', { min: 3, max: 30, int: true, optional: true }) ?? 10;
  const timed = req.body?.timed === true; const minutes = timed ? num(req.body?.minutes, 'minutes', { min: 5, max: 180, int: true, optional: true }) ?? 20 : null;
  const calculator = req.body?.calculator !== false;
  const formats = (strArray(req.body?.formats, 'formats', { maxItems: 3 }).filter((f) => ['mc', 'short', 'written'].includes(f)) as MockQ['format'][]);
  const fmts: MockQ['format'][] = formats.length ? formats : ['mc', 'short'];
  const seed = num(req.body?.seed, 'seed', { min: 0, max: 2 ** 31, int: true, optional: true }) ?? Math.floor(Math.random() * 2 ** 31);
  const rng = makeRng(seed ^ hashString(p.id));
  const usable = calculator ? skills : skills.filter((s) => !SKILL_MAP[s].calculator).concat(skills.filter((s) => SKILL_MAP[s].calculator).slice(0, 0));
  const pool = usable.length ? usable : skills;
  const diffs = [2, 3, 3, 3, 4, 2, 4, 3, 5, 3];
  const questions: MockQ[] = [];
  for (let i = 0; i < count; i++) {
    const skill = pool[i % pool.length];
    const fmt = fmts.includes('written') && i % 5 === 4 ? 'written' : fmts.filter((f) => f !== 'written')[i % Math.max(1, fmts.filter((f) => f !== 'written').length)] ?? 'short';
    let q = generateQuestion(skill, diffs[i % diffs.length], rng);
    if (fmt === 'mc') q = toMultipleChoice(q, rng);
    questions.push({ ...q, format: fmt });
  }
  const shuffled = shuffle(rng, questions);
  const id = randomUUID();
  run('INSERT INTO test_attempts (id, profile_id, test_plan_id, config, questions) VALUES (?, ?, ?, ?, ?)', id, p.id, planId, JSON.stringify({ count, timed, minutes, calculator, formats: fmts, seed, skills }), JSON.stringify(shuffled));
  track('mock_test_started', {}, optOut(p));
  res.json({ id, config: { count, timed, minutes, calculator, formats: fmts, seed }, questions: shuffled.map((q) => ({ ...toPublic(q), format: q.format, skillTitle: SKILL_MAP[q.skillId]?.title, explainPrompt: q.format === 'written' ? `Show your reasoning: explain how you solved it (${SKILL_MAP[q.skillId]?.explainPrompt ?? ''})` : undefined })) });
});

plansRouter.post('/mock-tests/:id/submit', (req, res) => {
  const p = P(req);
  const t = one<{ id: string; questions: string; config: string; test_plan_id: string | null; completed_at: string | null; started_at: string }>('SELECT * FROM test_attempts WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!t) throw notFound('Mock test not found');
  if (t.completed_at) throw bad('This mock test was already submitted.');
  const answers = (req.body?.answers ?? {}) as Record<string, string>;
  const explanations = (req.body?.explanations ?? {}) as Record<string, string>;
  const qs = json<MockQ[]>(t.questions, []);
  const perTopic: Record<string, { c: number; n: number }> = {}; const mistakes: Record<string, { count: number; message: string }> = {};
  let points = 0; let max = 0;
  const review = qs.map((q) => {
    const resp = String(answers[q.id] ?? '').slice(0, 300);
    const r = resp ? checkAnswer(q, resp) : { correct: false, feedback: 'Not answered.', mistakeType: 'blank' };
    let earned = r.correct ? 1 : 0; let worth = 1;
    let writtenNote: string | null = null;
    if (q.format === 'written') {
      worth = 2;
      const expl = String(explanations[q.id] ?? '').toLowerCase();
      const kws = SKILL_MAP[q.skillId]?.explainKeywords ?? [];
      const hit = kws.filter((k) => expl.includes(k.toLowerCase())).length;
      const reasoningPts = expl.split(/\s+/).length >= 8 && (hit >= 1 || /because|so|therefore|first|then/.test(expl)) ? 1 : 0;
      earned += reasoningPts;
      writtenNote = reasoningPts ? 'Reasoning shown clearly (+1).' : 'Explain each step and why it works to earn the reasoning point.';
    }
    points += earned; max += worth;
    perTopic[q.skillId] ??= { c: 0, n: 0 }; perTopic[q.skillId].n += worth; perTopic[q.skillId].c += earned;
    if (!r.correct && r.mistakeType && r.mistakeType !== 'other' && r.mistakeType !== 'blank') { mistakes[r.mistakeType] ??= { count: 0, message: r.feedback }; mistakes[r.mistakeType].count++; }
    run('INSERT INTO question_attempts (profile_id, question_id, skill_id, difficulty, correct, mistake_type, mode) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, q.id, q.skillId, q.difficulty, r.correct ? 1 : 0, r.mistakeType ?? null, 'mock');
    updateMastery(p.id, q.skillId, { correct: r.correct, difficulty: q.difficulty, hints: 0 });
    return { id: q.id, prompt: q.prompt, format: q.format, skillTitle: SKILL_MAP[q.skillId]?.title, response: resp, correct: r.correct, earned, worth, feedback: r.feedback, answer: q.answer, unit: q.unit, steps: q.steps, explanation: q.explanation, writtenNote };
  });
  const score = max ? Math.round((points / max) * 100) : 0;
  const topics = Object.entries(perTopic).map(([s, v]) => ({ skillId: s, title: SKILL_MAP[s]?.title ?? s, percent: Math.round((v.c / v.n) * 100), correct: v.c, total: v.n }));
  const mastered = topics.filter((x) => x.percent >= 80); const needsReview = topics.filter((x) => x.percent < 70);
  const analysis = {
    score, points, max, topics, mastered, needsReview,
    mistakes: Object.entries(mistakes).map(([type, v]) => ({ type, count: v.count, message: v.message })),
    recommendedLessons: needsReview.map((x) => ({ skillId: x.skillId, title: x.title, link: `/lesson/${x.skillId}` })),
    recommendedPractice: needsReview.map((x) => ({ skillId: x.skillId, title: x.title, link: `/practice/session?skill=${x.skillId}&mode=targeted` })),
    timeTakenSec: Math.round((Date.now() - new Date(t.started_at.replace(' ', 'T') + 'Z').getTime()) / 1000),
  };
  run("UPDATE test_attempts SET answers = ?, score = ?, analysis = ?, completed_at = datetime('now') WHERE id = ?", JSON.stringify({ answers, explanations }), score, JSON.stringify(analysis), t.id);
  if (t.test_plan_id) {
    const plan = one<{ plan: string }>('SELECT plan FROM test_plans WHERE id = ?', t.test_plan_id);
    if (plan) { const days = json<PlanDay[]>(plan.plan, []); for (const d of days) for (const it of d.items) if (it.kind === 'mock' && !it.done) { it.done = true; d.done = d.items.every((x) => x.done); break; } run('UPDATE test_plans SET plan = ? WHERE id = ?', JSON.stringify(days), t.test_plan_id); }
  }
  const xp = awardXp(p.id, 'test_complete', 'Mock test');
  recordActivity(p.id, Math.min(3600, analysis.timeTakenSec), qs.length);
  computeLearningLevel(p.id);
  const achievements = checkAchievements(p.id);
  track('mock_test_completed', { score_bucket: Math.floor(score / 20) * 20 }, optOut(p));
  res.json({ analysis, review, xp, achievements });
});

plansRouter.get('/mock-tests/:id', (req, res) => {
  const t = one<{ id: string; config: string; score: number | null; analysis: string | null; completed_at: string | null }>('SELECT id, config, score, analysis, completed_at FROM test_attempts WHERE id = ? AND profile_id = ?', req.params.id, P(req).id);
  if (!t) throw notFound();
  res.json({ test: { ...t, config: json(t.config, {}), analysis: json(t.analysis, null) } });
});
plansRouter.get('/mock-tests', (req, res) => {
  res.json({ tests: all('SELECT id, score, started_at, completed_at, test_plan_id FROM test_attempts WHERE profile_id = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 20', P(req).id) });
});

// ─────────────────────────────────────────── natural-language planner
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function parseDate(text: string, now = new Date(`${today()}T00:00:00Z`)): string | null {
  const t = text.toLowerCase();
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/); if (iso) return iso[1];
  if (/\btoday\b/.test(t)) return now.toISOString().slice(0, 10);
  if (/\btomorrow\b/.test(t)) return addDays(now.toISOString().slice(0, 10), 1);
  const inN = t.match(/\bin (\d{1,3}) (day|days|week|weeks)\b/); if (inN) return addDays(now.toISOString().slice(0, 10), Number(inN[1]) * (inN[2].startsWith('week') ? 7 : 1));
  if (/\bnext week\b/.test(t)) return addDays(now.toISOString().slice(0, 10), 7);
  for (let m = 0; m < 12; m++) {
    const re = new RegExp(`\\b(${MONTHS[m]}|${MONTHS[m].slice(0, 3)})\\.?\\s+(\\d{1,2})(st|nd|rd|th)?\\b|\\b(\\d{1,2})(st|nd|rd|th)?\\s+(of\\s+)?(${MONTHS[m]}|${MONTHS[m].slice(0, 3)})\\b`);
    const mm = t.match(re);
    if (mm) {
      const day = Number(mm[2] ?? mm[4]); let year = now.getUTCFullYear();
      let d = new Date(Date.UTC(year, m, day));
      if (d < now) { year++; d = new Date(Date.UTC(year, m, day)); }
      return d.toISOString().slice(0, 10);
    }
  }
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) { let d = new Date(Date.UTC(now.getUTCFullYear(), Number(slash[1]) - 1, Number(slash[2]))); if (d < now) d = new Date(Date.UTC(now.getUTCFullYear() + 1, Number(slash[1]) - 1, Number(slash[2]))); if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
  for (let w = 0; w < 7; w++) if (new RegExp(`\\b${WEEKDAYS[w]}\\b`).test(t)) { const diff = (w - now.getUTCDay() + 7) % 7 || 7; return addDays(now.toISOString().slice(0, 10), diff); }
  return null;
}

plansRouter.post('/planner/parse', (req, res) => {
  const p = P(req);
  const text = str(req.body?.text, 'Text', { max: 300 });
  const date = parseDate(text);
  if (!date) throw bad('I couldn’t find a date. Try something like “Math test October 15” or “Quadratics homework due Friday”.');
  const isTest = /\b(test|exam|quiz|midterm|final|assessment)\b/i.test(text);
  const cleaned = text.replace(/\b(math|maths|test|exam|quiz|on|due|by|for|my|a|an|the|homework|assignment|next|week|tomorrow|today|in \d+ days?)\b/gi, ' ').replace(/\b\d{1,2}(st|nd|rd|th)?\b/g, ' ');
  const topic = cleaned.replace(new RegExp(`\\b(${[...MONTHS, ...MONTHS.map((m) => m.slice(0, 3)), ...WEEKDAYS].join('|')})\\b`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
  if (isTest) {
    const skills = topic ? matchSkills(topic).skills.slice(0, 6) : [];
    const lvl = p.learning_level ?? p.school_grade ?? 7;
    const fallback = SKILLS.filter((s) => Math.abs(s.grade - lvl) <= 0.5 && !['mental', 'puzzles', 'realworld'].includes(s.domain)).slice(0, 4).map((s) => s.id);
    const id = createTestPlan(p, { title: text.slice(0, 120), testDate: date < today() ? today() : date, skills: skills.length ? skills : fallback });
    return res.json({ kind: 'test', id, date, link: `/test-prep/${id}`, message: `Created a study plan for your test on ${date}.` });
  }
  const id = createAssignment(p, { title: text.slice(0, 120), dueDate: date, topic });
  res.json({ kind: 'assignment', id, date, link: '/organizer', message: `Added to your homework organizer (due ${date}).` });
});

plansRouter.get('/planner', (req, res) => {
  const p = P(req);
  const from = today(); const to = addDays(from, 41);
  const events: { date: string; kind: string; title: string; link: string; done: boolean; minutes?: number }[] = [];
  for (const t of all<{ id: string; title: string; test_date: string; plan: string }>('SELECT id, title, test_date, plan FROM test_plans WHERE profile_id = ? AND archived = 0', p.id)) {
    const { days } = adjustPlan(json<PlanDay[]>(t.plan, []));
    for (const d of days) if (d.date >= from && d.date <= to) events.push({ date: d.date, kind: d.type === 'warmup' ? 'test' : d.type, title: d.type === 'warmup' ? `📝 ${t.title}` : `${d.title} (${t.title})`, link: `/test-prep/${t.id}`, done: d.done, minutes: d.items.reduce((s, x) => s + x.minutes, 0) });
  }
  for (const a of all<{ id: string; title: string; due_date: string | null; done: number }>('SELECT id, title, due_date, done FROM assignments WHERE profile_id = ?', p.id)) if (a.due_date && a.due_date >= from && a.due_date <= to) events.push({ date: a.due_date, kind: 'homework', title: `Due: ${a.title}`, link: '/organizer', done: !!a.done });
  const activity = all<{ day: string; seconds: number }>("SELECT day, seconds FROM activity_days WHERE profile_id = ? AND day >= date('now','-6 days')", p.id);
  res.json({ events: events.sort((a, b) => a.date.localeCompare(b.date)), dailyGoalMin: p.daily_goal_min, activity, today: from });
});

// ─────────────────────────────────────────── homework organizer
function breakdown(title: string, topic: string, questions: string, skillId: string | null, mastery: number | null) {
  const tasks: { label: string; done: boolean }[] = [];
  if (skillId && (mastery ?? 0) < 70) tasks.push({ label: `Review the ${SKILL_MAP[skillId].title} lesson`, done: false });
  else if (topic) tasks.push({ label: `Re-read your notes on ${topic}`, done: false });
  const range = questions.match(/(\d+)\s*[-–to]+\s*(\d+)/);
  const count = range ? Number(range[2]) - Number(range[1]) + 1 : Number(questions.match(/(\d+)/)?.[1] ?? 0);
  if (range && count > 0) {
    const start = Number(range[1]);
    for (let i = start; i <= Number(range[2]); i += 5) tasks.push({ label: `Questions ${i}–${Math.min(Number(range[2]), i + 4)}`, done: false });
  } else if (count > 0) for (let i = 1; i <= count; i += 5) tasks.push({ label: `Questions ${i}–${Math.min(count, i + 4)}`, done: false });
  else tasks.push({ label: `Work through ${title}`, done: false });
  tasks.push({ label: 'Check your answers (substitute back / estimate)', done: false });
  tasks.push({ label: 'Ask the tutor about anything you got stuck on', done: false });
  return tasks;
}
function createAssignment(p: ProfileRow, b: Record<string, unknown>) {
  const title = str(b.title, 'Title', { max: 120 });
  const dueDate = b.dueDate ? isoDate(String(b.dueDate)) : null;
  const topic = str(b.topic, 'Topic', { optional: true, max: 80 });
  const questions = str(b.questions, 'Questions', { optional: true, max: 40 });
  const skillId = topic ? matchSkills(topic).skills[0] ?? null : null;
  const mm = masteryMap(p.id);
  const tasks = Array.isArray(b.tasks) && b.tasks.length ? strArray(b.tasks, 'tasks', { maxItems: 30, maxLen: 120 }).map((label) => ({ label, done: false })) : breakdown(title, topic, questions, skillId, skillId ? mm[skillId]?.effective ?? null : null);
  const id = randomUUID();
  run('INSERT INTO assignments (id, profile_id, title, due_date, topic, skill_id, tasks) VALUES (?, ?, ?, ?, ?, ?, ?)', id, p.id, title, dueDate, topic || null, skillId, JSON.stringify(tasks));
  return id;
}
plansRouter.get('/assignments', (req, res) => {
  const rows = all<{ id: string; title: string; due_date: string | null; topic: string | null; skill_id: string | null; tasks: string; done: number; created_at: string }>('SELECT * FROM assignments WHERE profile_id = ? ORDER BY done, COALESCE(due_date, \'9999\')', P(req).id);
  res.json({ assignments: rows.map((r) => ({ ...r, tasks: json(r.tasks, []), skillTitle: r.skill_id ? SKILL_MAP[r.skill_id]?.title : null, daysLeft: r.due_date ? daysBetween(today(), r.due_date) : null })) });
});
plansRouter.post('/assignments', (req, res) => res.json({ id: createAssignment(P(req), req.body ?? {}) }));
plansRouter.patch('/assignments/:id', (req, res) => {
  const p = P(req);
  const a = one<{ tasks: string }>('SELECT tasks FROM assignments WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!a) throw notFound();
  const tasks = json<{ label: string; done: boolean }[]>(a.tasks, []);
  if (req.body?.task !== undefined) { const i = num(req.body.task, 'task', { min: 0, max: tasks.length - 1, int: true })!; tasks[i].done = req.body?.taskDone !== false; }
  const done = req.body?.done !== undefined ? (req.body.done ? 1 : 0) : tasks.length && tasks.every((t) => t.done) ? 1 : 0;
  run('UPDATE assignments SET tasks = ?, done = ? WHERE id = ?', JSON.stringify(tasks), done, req.params.id);
  if (req.body?.task !== undefined) recordActivity(p.id, 30);
  res.json({ ok: true, tasks, done: !!done });
});
plansRouter.delete('/assignments/:id', (req, res) => { run('DELETE FROM assignments WHERE id = ? AND profile_id = ?', req.params.id, P(req).id); res.json({ ok: true }); });
/** Suggest an order of work across all open assignments (due date first, then remaining effort). */
plansRouter.get('/assignments/organize', (req, res) => {
  const p = P(req);
  const open = all<{ id: string; title: string; due_date: string | null; tasks: string }>('SELECT id, title, due_date, tasks FROM assignments WHERE profile_id = ? AND done = 0', p.id)
    .map((a) => ({ ...a, left: json<{ done: boolean }[]>(a.tasks, []).filter((t) => !t.done).length, daysLeft: a.due_date ? daysBetween(today(), a.due_date) : 99 }));
  const sorted = open.sort((a, b) => a.daysLeft - b.daysLeft || b.left - a.left);
  const minutesPerTask = 12;
  const schedule = sorted.map((a) => ({ id: a.id, title: a.title, daysLeft: a.daysLeft, tasksLeft: a.left, minutesToday: Math.min(a.left, Math.max(1, Math.ceil(a.left / Math.max(1, a.daysLeft)))) * minutesPerTask, priority: a.daysLeft <= 1 ? 'High' : a.daysLeft <= 3 ? 'Medium' : 'Low' }));
  const total = schedule.reduce((s, x) => s + x.minutesToday, 0);
  res.json({ schedule, totalMinutesToday: total, tip: total > 90 ? 'That’s a big day — split it into 25-minute focus blocks with short breaks.' : 'A manageable day. Start with the highest-priority item.' });
});
